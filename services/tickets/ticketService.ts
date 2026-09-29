import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose, { type FilterQuery, type Types } from "mongoose";
import User from "../../models/User.js";
import Ticket, { type TicketDocument } from "../../models/Ticket.js";
import TicketComment from "../../models/TicketComment.js";
import TicketEvent from "../../models/TicketEvent.js";
import TicketAttachment from "../../models/TicketAttachment.js";
import TicketLink from "../../models/TicketLink.js";
import TicketTag from "../../models/TicketTag.js";
import TicketCounter from "../../models/TicketCounter.js";
import TicketCategory from "../../models/TicketCategory.js";
import Team from "../../models/Team.js";
import TeamMember from "../../models/TeamMember.js";
import CsatResponse from "../../models/CsatResponse.js";
import type { AuthUser } from "../../types/auth.js";
import {
  ACTIVE_STATUSES,
  LINK_TYPES,
  type TicketChannel,
  type TicketLinkType,
  type TicketPriority,
  type TicketStatus,
  isTicketChannel,
  isTicketPriority,
  isTicketStatus,
} from "../../types/tickets.js";
import { emitDomainEvent } from "./bus.js";
import { TicketError } from "./errors.js";
import { assertAssigneeAllowed, assertCan, queueFilter } from "./policy.js";
import { canTransition } from "./transitions.js";
import { dueDatesFor, reopenWindowMs, slaRiskWindowMs } from "./sla.js";
import { triageTicket } from "./triage.js";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const PRIORITY_LADDER: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export interface CreateTicketInput {
  subject?: string;
  description?: string;
  categoryId?: string | null;
  priority?: string | null;
  teamId?: string | null;
  assigneeId?: string | null;
  requesterId?: string | null;
  channel?: string | null;
  sourceRef?: string | null;
}

export interface TicketListQuery {
  status?: string;
  priority?: string;
  assigneeId?: string;
  teamId?: string;
  categoryId?: string;
  sla?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

function oid(id: string, label = "id"): Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw new TicketError(400, `Invalid ${label}`);
  return new mongoose.Types.ObjectId(id);
}

function actorOid(actorId: string | null): Types.ObjectId | null {
  if (!actorId || !mongoose.isValidObjectId(actorId)) return null;
  return new mongoose.Types.ObjectId(actorId);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageWindow(page?: number, limit?: number): { page: number; limit: number; skip: number } {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

async function nextNumber(): Promise<string> {
  await TicketCounter.updateOne(
    { key: "ticket" },
    { $setOnInsert: { seq: 1041 } },
    { upsert: true }
  );
  const counter = await TicketCounter.findOneAndUpdate(
    { key: "ticket" },
    { $inc: { seq: 1 } },
    { new: true }
  );
  return `TCK-${counter?.seq ?? 1042}`;
}

async function writeEvent(input: {
  ticketId: Types.ObjectId;
  actorId: string | null;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await TicketEvent.create({
    ticketId: input.ticketId,
    actorId: actorOid(input.actorId),
    type: input.type,
    fromValue: input.fromValue ?? null,
    toValue: input.toValue ?? null,
    metadata: input.metadata ?? {},
  });
}

async function mustTicket(id: string): Promise<TicketDocument> {
  if (!mongoose.isValidObjectId(id)) throw new TicketError(400, "Invalid id");
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new TicketError(404, "Ticket not found");
  return ticket;
}

async function applyTransition(
  ticket: TicketDocument,
  to: TicketStatus,
  actorId: string | null,
  opts: { resolutionNote?: string | null; reason?: string | null }
): Promise<TicketDocument> {
  const from = ticket.status;
  if (!canTransition(from, to)) {
    throw new TicketError(400, `Cannot move ${from} to ${to}`);
  }
  if (to === "RESOLVED" && !String(opts.resolutionNote || "").trim()) {
    throw new TicketError(400, "A resolution note is required");
  }

  const now = new Date();
  if (to === "PENDING_CUSTOMER" && !ticket.slaPausedAt) {
    ticket.slaPausedAt = now;
  }
  if (from === "PENDING_CUSTOMER" && to !== "PENDING_CUSTOMER" && ticket.slaPausedAt) {
    const pausedMs = now.getTime() - ticket.slaPausedAt.getTime();
    if (ticket.slaResponseDue) {
      ticket.slaResponseDue = new Date(ticket.slaResponseDue.getTime() + pausedMs);
    }
    if (ticket.slaResolutionDue) {
      ticket.slaResolutionDue = new Date(ticket.slaResolutionDue.getTime() + pausedMs);
    }
    ticket.slaPausedAt = null;
  }

  if (to === "RESOLVED") {
    ticket.resolvedAt = now;
    ticket.closedAt = null;
    ticket.resolutionNote = String(opts.resolutionNote).trim();
  }
  if (to === "CLOSED") ticket.closedAt = now;
  if (to === "REOPENED") {
    ticket.resolvedAt = null;
    ticket.closedAt = null;
  }

  ticket.status = to;
  await ticket.save();
  await writeEvent({
    ticketId: ticket._id,
    actorId,
    type: "status.changed",
    fromValue: from,
    toValue: to,
    metadata: {
      reason: opts.reason ?? null,
      resolutionNote: to === "RESOLVED" ? ticket.resolutionNote : null,
    },
  });

  if (to === "RESOLVED") {
    emitDomainEvent({
      name: "ticket.resolved",
      ticketId: ticket.id,
      actorId,
      payload: { number: ticket.number },
    });
  } else if (to === "CLOSED") {
    emitDomainEvent({
      name: "ticket.closed",
      ticketId: ticket.id,
      actorId,
      payload: { number: ticket.number },
    });
  } else if (to === "REOPENED") {
    emitDomainEvent({
      name: "ticket.reopened",
      ticketId: ticket.id,
      actorId,
      payload: { number: ticket.number },
    });
  }

  return ticket;
}

async function requesterFor(actor: AuthUser, requestedId?: string | null): Promise<string> {
  if (actor.role === "USER") return actor.id;
  if (!requestedId) return actor.id;
  if (!mongoose.isValidObjectId(requestedId)) throw new TicketError(400, "Invalid requesterId");
  const user = await User.findById(requestedId).select("_id");
  if (!user) throw new TicketError(404, "Requester not found");
  return user.id;
}

export async function createTicket(actor: AuthUser, input: CreateTicketInput): Promise<TicketDocument> {
  await assertCan(actor, "create");
  const subject = String(input.subject || "").trim();
  const description = String(input.description || "").trim();
  if (!subject || !description) {
    throw new TicketError(400, "subject and description are required");
  }

  const channel: TicketChannel =
    input.channel && isTicketChannel(input.channel) ? input.channel : "API";
  const priority = input.priority && isTicketPriority(input.priority) ? input.priority : null;
  const requesterId = await requesterFor(actor, input.requesterId);
  const requestedAssignee = actor.role === "USER" ? null : input.assigneeId || null;
  const now = new Date();
  const triage = await triageTicket(
    {
      subject,
      description,
      channel,
      categoryId: input.categoryId,
      priority,
      teamId: input.teamId,
      assigneeId: requestedAssignee,
    },
    now
  );

  const ticket = await Ticket.create({
    number: await nextNumber(),
    subject,
    description,
    status: "NEW",
    priority: triage.priority,
    categoryId: triage.categoryId ? oid(triage.categoryId, "categoryId") : null,
    requesterId: oid(requesterId, "requesterId"),
    assigneeId: null,
    teamId: triage.teamId ? oid(triage.teamId, "teamId") : null,
    channel,
    sourceRef: input.sourceRef ? String(input.sourceRef) : null,
    slaResponseDue: triage.slaResponseDue,
    slaResolutionDue: triage.slaResolutionDue,
  });

  await writeEvent({
    ticketId: ticket._id,
    actorId: actor.id,
    type: "ticket.created",
    toValue: "NEW",
    metadata: { channel, requesterId },
  });
  emitDomainEvent({
    name: "ticket.created",
    ticketId: ticket.id,
    actorId: actor.id,
    payload: { number: ticket.number, requesterId },
  });

  if (requestedAssignee) {
    try {
      return await assignTicket(actor, ticket.id, requestedAssignee);
    } catch (error) {
      await TicketEvent.deleteMany({ ticketId: ticket._id });
      await Ticket.deleteOne({ _id: ticket._id });
      throw error;
    }
  }
  if (triage.assigneeId) return autoAssign(ticket, triage.assigneeId, actor.id);
  return ticket;
}

async function autoAssign(
  ticket: TicketDocument,
  assigneeId: string,
  actorId: string
): Promise<TicketDocument> {
  const user = await User.findById(assigneeId).select("_id role");
  if (!user || user.role === "USER") return ticket;
  const from = ticket.assigneeId?.toString() ?? null;
  ticket.assigneeId = user._id;
  await ticket.save();
  await writeEvent({
    ticketId: ticket._id,
    actorId,
    type: "assigned",
    fromValue: from,
    toValue: user.id,
    metadata: { reason: "Auto-assigned" },
  });
  emitDomainEvent({
    name: "ticket.assigned",
    ticketId: ticket.id,
    actorId,
    payload: { assigneeId: user.id, number: ticket.number },
  });
  if (ticket.status === "NEW") {
    return applyTransition(ticket, "OPEN", actorId, { reason: "Auto-assigned" });
  }
  return ticket;
}

export async function ingestEmail(input: {
  from?: string;
  subject?: string;
  body?: string;
  sourceRef?: string | null;
}): Promise<TicketDocument> {
  const email = String(input.from || "").trim().toLowerCase();
  if (!email) throw new TicketError(400, "from is required");
  const user = await User.findOne({ email });
  if (!user) throw new TicketError(404, "No user for that email");
  const actor: AuthUser = {
    id: user.id,
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || null,
  };
  return createTicket(actor, {
    subject: input.subject,
    description: input.body,
    channel: "EMAIL",
    sourceRef: input.sourceRef ?? null,
    requesterId: actor.id,
  });
}

function seesInternal(actor: AuthUser): boolean {
  return actor.role === "ADMIN" || actor.role === "TEAM_LEAD" || actor.role === "AGENT";
}

export async function getTicket(actor: AuthUser, id: string) {
  const ticket = await mustTicket(id);
  await assertCan(actor, "read", ticket);
  const commentFilter: FilterQuery<{ isInternal?: boolean }> = { ticketId: ticket._id };
  if (!seesInternal(actor)) commentFilter.isInternal = false;
  const [comments, attachments, links, tags] = await Promise.all([
    TicketComment.find(commentFilter).sort({ createdAt: 1 }),
    TicketAttachment.find({ ticketId: ticket._id }).sort({ createdAt: 1 }),
    TicketLink.find({ $or: [{ ticketId: ticket._id }, { relatedTicketId: ticket._id }] }),
    TicketTag.find({ ticketId: ticket._id }).sort({ tag: 1 }),
  ]);
  return { ticket, comments, attachments, links, tags };
}

export async function listOwnTickets(actor: AuthUser, query: TicketListQuery) {
  return listWithFilter(actor, { requesterId: actor.id }, query);
}

export async function listQueueTickets(actor: AuthUser, query: TicketListQuery) {
  await assertCan(actor, "list_queue");
  const scope = await queueFilter(actor);
  return listWithFilter(actor, scope, query);
}

async function listWithFilter(
  _actor: AuthUser,
  scope: FilterQuery<TicketDocument>,
  query: TicketListQuery
) {
  const parts: FilterQuery<TicketDocument>[] = [];
  if (Object.keys(scope).length) parts.push(scope);

  const fields: FilterQuery<TicketDocument> = {};
  if (query.status) {
    if (!isTicketStatus(query.status)) throw new TicketError(400, "Invalid status");
    fields.status = query.status;
  }
  if (query.priority) {
    if (!isTicketPriority(query.priority)) throw new TicketError(400, "Invalid priority");
    fields.priority = query.priority;
  }
  if (query.assigneeId) fields.assigneeId = oid(query.assigneeId, "assigneeId");
  if (query.teamId) fields.teamId = oid(query.teamId, "teamId");
  if (query.categoryId) fields.categoryId = oid(query.categoryId, "categoryId");
  if (query.from || query.to) {
    const range: { $gte?: Date; $lt?: Date } = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new TicketError(400, "from must be a valid ISO date");
      range.$gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new TicketError(400, "to must be a valid ISO date");
      range.$lt = to;
    }
    fields.createdAt = range;
  }

  const now = new Date();
  if (query.sla === "overdue") {
    fields.slaPausedAt = null;
    fields.slaResolutionDue = { $lt: now };
    if (!fields.status) fields.status = { $in: ACTIVE_STATUSES };
  } else if (query.sla === "at_risk") {
    fields.slaPausedAt = null;
    fields.slaResolutionDue = { $gte: now, $lte: new Date(now.getTime() + slaRiskWindowMs()) };
    if (!fields.status) fields.status = { $in: ACTIVE_STATUSES };
  }
  if (Object.keys(fields).length) parts.push(fields);

  if (query.sla === "ok") {
    const horizon = new Date(now.getTime() + slaRiskWindowMs());
    parts.push({
      $or: [
        { slaResolutionDue: null },
        { slaResolutionDue: { $gt: horizon } },
        { slaPausedAt: { $ne: null } },
      ],
    });
  }
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q.trim()), "i");
    parts.push({ $or: [{ number: rx }, { subject: rx }, { description: rx }] });
  }

  const filter: FilterQuery<TicketDocument> = parts.length > 1 ? { $and: parts } : (parts[0] ?? {});
  const window = pageWindow(query.page, query.limit);
  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.find(filter).sort({ createdAt: -1 }).skip(window.skip).limit(window.limit),
  ]);
  return { tickets, total, page: window.page, limit: window.limit };
}

export async function updateTicket(
  actor: AuthUser,
  id: string,
  patch: {
    subject?: string;
    description?: string;
    priority?: string;
    categoryId?: string | null;
    teamId?: string | null;
  }
): Promise<TicketDocument> {
  const ticket = await mustTicket(id);
  await assertCan(actor, "update", ticket);
  if ("status" in patch) throw new TicketError(400, "Status changes go through transition");

  if (patch.subject != null) {
    const next = String(patch.subject).trim();
    if (!next) throw new TicketError(400, "subject cannot be empty");
    if (next !== ticket.subject) {
      const from = ticket.subject;
      ticket.subject = next;
      await writeEvent({
        ticketId: ticket._id,
        actorId: actor.id,
        type: "field.changed",
        fromValue: from,
        toValue: next,
        metadata: { field: "subject" },
      });
    }
  }

  if (patch.description != null) {
    const next = String(patch.description).trim();
    if (!next) throw new TicketError(400, "description cannot be empty");
    if (next !== ticket.description) {
      ticket.description = next;
      await writeEvent({
        ticketId: ticket._id,
        actorId: actor.id,
        type: "field.changed",
        fromValue: null,
        toValue: null,
        metadata: { field: "description" },
      });
    }
  }

  if (patch.priority != null) {
    if (!isTicketPriority(patch.priority)) throw new TicketError(400, "Invalid priority");
    if (patch.priority !== ticket.priority) {
      const from = ticket.priority;
      ticket.priority = patch.priority;
      if (!ticket.slaPausedAt && !ticket.resolvedAt && !ticket.closedAt) {
        const due = await dueDatesFor(ticket.createdAt ?? new Date(), patch.priority);
        ticket.slaResponseDue = due.response;
        ticket.slaResolutionDue = due.resolution;
      }
      await writeEvent({
        ticketId: ticket._id,
        actorId: actor.id,
        type: "field.changed",
        fromValue: from,
        toValue: patch.priority,
        metadata: { field: "priority" },
      });
    }
  }

  if (patch.categoryId !== undefined) {
    const next = patch.categoryId ? oid(patch.categoryId, "categoryId") : null;
    if (next) {
      const category = await TicketCategory.findById(next);
      if (!category) throw new TicketError(404, "Category not found");
    }
    const from = ticket.categoryId?.toString() ?? null;
    const to = next?.toString() ?? null;
    if (from !== to) {
      ticket.categoryId = next;
      await writeEvent({
        ticketId: ticket._id,
        actorId: actor.id,
        type: "field.changed",
        fromValue: from,
        toValue: to,
        metadata: { field: "categoryId" },
      });
    }
  }

  if (patch.teamId !== undefined) {
    const next = patch.teamId ? oid(patch.teamId, "teamId") : null;
    if (next && !(await Team.exists({ _id: next }))) throw new TicketError(404, "Team not found");
    const from = ticket.teamId?.toString() ?? null;
    const to = next?.toString() ?? null;
    if (from !== to) {
      ticket.teamId = next;
      await writeEvent({
        ticketId: ticket._id,
        actorId: actor.id,
        type: "field.changed",
        fromValue: from,
        toValue: to,
        metadata: { field: "teamId" },
      });
    }
  }

  await ticket.save();
  return ticket;
}

export async function assignTicket(
  actor: AuthUser,
  id: string,
  assigneeId?: string | null
): Promise<TicketDocument> {
  const ticket = await mustTicket(id);
  const target = String(assigneeId || actor.id);
  await assertAssigneeAllowed(actor, ticket, target);
  const user = await User.findById(target).select("_id role");
  if (!user) throw new TicketError(404, "Assignee not found");
  if (user.role === "USER") throw new TicketError(400, "Assignee must be an agent, lead, or admin");

  const from = ticket.assigneeId?.toString() ?? null;
  ticket.assigneeId = user._id;
  await ticket.save();
  await writeEvent({
    ticketId: ticket._id,
    actorId: actor.id,
    type: "assigned",
    fromValue: from,
    toValue: user.id,
  });
  emitDomainEvent({
    name: "ticket.assigned",
    ticketId: ticket.id,
    actorId: actor.id,
    payload: { assigneeId: user.id, number: ticket.number },
  });

  if (ticket.status === "NEW") {
    return applyTransition(ticket, "OPEN", actor.id, { reason: "Assigned" });
  }
  return ticket;
}

export async function transitionTicket(
  actor: AuthUser,
  id: string,
  to: string,
  resolutionNote?: string | null
): Promise<TicketDocument> {
  const ticket = await mustTicket(id);
  await assertCan(actor, "transition", ticket);
  if (!isTicketStatus(to)) throw new TicketError(400, "Invalid status");
  return applyTransition(ticket, to, actor.id, { resolutionNote });
}

export async function reopenTicket(actor: AuthUser, id: string): Promise<TicketDocument> {
  const ticket = await mustTicket(id);
  await assertCan(actor, "reopen", ticket);
  if (ticket.status !== "RESOLVED") throw new TicketError(400, "Only a resolved ticket can be reopened");
  if (!ticket.resolvedAt || Date.now() - ticket.resolvedAt.getTime() > reopenWindowMs()) {
    throw new TicketError(400, "Reopen window has passed");
  }
  return applyTransition(ticket, "REOPENED", actor.id, { reason: "Reopened" });
}

export async function addComment(
  actor: AuthUser,
  id: string,
  body: string,
  isInternal: boolean
) {
  const ticket = await mustTicket(id);
  if (ticket.status === "CLOSED") throw new TicketError(400, "Ticket is closed");
  if (isInternal) await assertCan(actor, "internal_note", ticket);
  else await assertCan(actor, "comment", ticket);

  const text = String(body || "").trim();
  if (!text) throw new TicketError(400, "body is required");

  const comment = await TicketComment.create({
    ticketId: ticket._id,
    authorId: oid(actor.id, "author"),
    body: text,
    isInternal,
  });
  await writeEvent({
    ticketId: ticket._id,
    actorId: actor.id,
    type: "comment.added",
    toValue: comment.id,
    metadata: { isInternal },
  });

  if (!isInternal && actor.id !== ticket.requesterId.toString() && !ticket.firstResponseAt) {
    ticket.firstResponseAt = new Date();
    await ticket.save();
  }

  if (
    !isInternal &&
    actor.id === ticket.requesterId.toString() &&
    ticket.status === "PENDING_CUSTOMER"
  ) {
    await applyTransition(ticket, "OPEN", actor.id, { reason: "Customer reply" });
  }

  emitDomainEvent({
    name: "ticket.commented",
    ticketId: ticket.id,
    actorId: actor.id,
    payload: { isInternal, commentId: comment.id, number: ticket.number },
  });
  return comment;
}

export async function listEvents(actor: AuthUser, id: string) {
  const ticket = await mustTicket(id);
  await assertCan(actor, "events", ticket);
  const events = await TicketEvent.find({ ticketId: ticket._id }).sort({ createdAt: 1 });
  return events;
}

export async function linkTickets(
  actor: AuthUser,
  id: string,
  relatedTicketId: string,
  type: string
) {
  const ticket = await mustTicket(id);
  await assertCan(actor, "update", ticket);
  if (!(LINK_TYPES as readonly string[]).includes(type)) throw new TicketError(400, "Invalid link type");
  if (relatedTicketId === id) throw new TicketError(400, "A ticket cannot link to itself");
  const related = await mustTicket(relatedTicketId);
  try {
    const link = await TicketLink.create({
      ticketId: ticket._id,
      relatedTicketId: related._id,
      type: type as TicketLinkType,
    });
    await writeEvent({
      ticketId: ticket._id,
      actorId: actor.id,
      type: "link.added",
      toValue: related.number,
      metadata: { linkType: type },
    });
    return link;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new TicketError(409, "Link already exists");
    }
    throw error;
  }
}

export async function addTag(actor: AuthUser, id: string, tag: string) {
  const ticket = await mustTicket(id);
  await assertCan(actor, "update", ticket);
  const clean = String(tag || "").trim().toLowerCase();
  if (!clean) throw new TicketError(400, "tag is required");
  try {
    const row = await TicketTag.create({ ticketId: ticket._id, tag: clean });
    await writeEvent({
      ticketId: ticket._id,
      actorId: actor.id,
      type: "tag.added",
      toValue: clean,
    });
    return row;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new TicketError(409, "Tag already exists");
    }
    throw error;
  }
}

export async function addAttachment(
  actor: AuthUser,
  id: string,
  input: { filename?: string; mime?: string; contentBase64?: string; commentId?: string | null }
) {
  const ticket = await mustTicket(id);
  await assertCan(actor, "comment", ticket);
  const filename = path.basename(String(input.filename || "")).replace(/[^a-zA-Z0-9._-]/g, "_");
  const mime = String(input.mime || "").trim();
  if (!filename || !mime || !input.contentBase64) {
    throw new TicketError(400, "filename, mime, and contentBase64 are required");
  }
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new TicketError(400, "Attachment must be between 1 byte and 5 MB");
  }

  let commentId: Types.ObjectId | null = null;
  if (input.commentId) {
    if (!mongoose.isValidObjectId(input.commentId)) throw new TicketError(400, "Invalid commentId");
    const comment = await TicketComment.findOne({ _id: input.commentId, ticketId: ticket._id });
    if (!comment) throw new TicketError(404, "Comment not found");
    commentId = comment._id;
  }

  const storageKey = path.posix.join(
    "tickets",
    ticket.id,
    `${crypto.randomBytes(8).toString("hex")}-${filename}`
  );
  const absolute = path.resolve("uploads", storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);

  const attachment = await TicketAttachment.create({
    ticketId: ticket._id,
    commentId,
    storageKey,
    filename,
    size: bytes.length,
    mime,
  });
  await writeEvent({
    ticketId: ticket._id,
    actorId: actor.id,
    type: "attachment.added",
    toValue: filename,
    metadata: { size: bytes.length, mime },
  });
  return attachment;
}

export async function submitCsat(
  actor: AuthUser,
  id: string,
  score: number,
  comment?: string
) {
  const ticket = await mustTicket(id);
  if (ticket.requesterId.toString() !== actor.id) throw new TicketError(403, "Forbidden");
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") {
    throw new TicketError(400, "Survey is available after the ticket is resolved");
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new TicketError(400, "score must be an integer from 1 to 5");
  }
  try {
    return await CsatResponse.create({
      ticketId: ticket._id,
      requesterId: ticket.requesterId,
      score,
      comment: String(comment || "").trim(),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new TicketError(409, "A survey was already submitted");
    }
    throw error;
  }
}

async function closeOne(actor: AuthUser, id: string): Promise<void> {
  const ticket = await mustTicket(id);
  await assertCan(actor, "transition", ticket);
  if (ticket.status === "RESOLVED") {
    await applyTransition(ticket, "CLOSED", actor.id, { reason: "Bulk close" });
    return;
  }
  if (canTransition(ticket.status, "RESOLVED")) {
    await applyTransition(ticket, "RESOLVED", actor.id, {
      resolutionNote: "Closed in bulk",
      reason: "Bulk close",
    });
    await applyTransition(ticket, "CLOSED", actor.id, { reason: "Bulk close" });
    return;
  }
  throw new TicketError(400, `Cannot close a ticket in ${ticket.status}`);
}

export async function bulkAct(
  actor: AuthUser,
  ids: string[],
  action: string,
  extra: { assigneeId?: string; tag?: string }
) {
  if (!Array.isArray(ids) || !ids.length) throw new TicketError(400, "ids are required");
  if (ids.length > 100) throw new TicketError(400, "Bulk actions are limited to 100 tickets");
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of ids) {
    try {
      if (action === "assign") await assignTicket(actor, id, extra.assigneeId);
      else if (action === "close") await closeOne(actor, id);
      else if (action === "tag") await addTag(actor, id, extra.tag || "");
      else throw new TicketError(400, "action must be assign, close, or tag");
      results.push({ id, ok: true });
    } catch (error) {
      results.push({
        id,
        ok: false,
        message: error instanceof TicketError ? error.message : "Failed",
      });
    }
  }
  return results;
}

function bumpPriority(priority: TicketPriority): TicketPriority {
  const index = PRIORITY_LADDER.indexOf(priority);
  return PRIORITY_LADDER[Math.min(PRIORITY_LADDER.length - 1, index + 1)] ?? "URGENT";
}

export async function runSlaPass(now = new Date()): Promise<void> {
  const horizon = new Date(now.getTime() + slaRiskWindowMs());
  const tickets = await Ticket.find({
    status: { $in: ACTIVE_STATUSES },
    slaPausedAt: null,
    slaResolutionDue: { $ne: null, $lte: horizon },
  }).limit(200);

  for (const ticket of tickets) {
    const due = ticket.slaResolutionDue;
    if (!due) continue;
    const breached = due.getTime() <= now.getTime();
    const type = breached ? "sla.breached" : "sla.at_risk";
    const already = await TicketEvent.exists({ ticketId: ticket._id, type });
    if (already) continue;

    if (breached) {
      const nextPriority = bumpPriority(ticket.priority);
      if (nextPriority !== ticket.priority) {
        const from = ticket.priority;
        ticket.priority = nextPriority;
        await writeEvent({
          ticketId: ticket._id,
          actorId: null,
          type: "field.changed",
          fromValue: from,
          toValue: nextPriority,
          metadata: { field: "priority", reason: "SLA breach" },
        });
      }
      if (ticket.teamId) {
        const lead = await TeamMember.findOne({ teamId: ticket.teamId, isLead: true });
        if (lead && ticket.assigneeId?.toString() !== lead.userId.toString()) {
          const from = ticket.assigneeId?.toString() ?? null;
          ticket.assigneeId = lead.userId;
          await writeEvent({
            ticketId: ticket._id,
            actorId: null,
            type: "assigned",
            fromValue: from,
            toValue: lead.userId.toString(),
            metadata: { reason: "SLA breach" },
          });
          emitDomainEvent({
            name: "ticket.assigned",
            ticketId: ticket.id,
            actorId: null,
            payload: { assigneeId: lead.userId.toString(), number: ticket.number },
          });
        }
      }
      await ticket.save();
    }

    await writeEvent({
      ticketId: ticket._id,
      actorId: null,
      type,
      toValue: due.toISOString(),
    });
    emitDomainEvent({
      name: type,
      ticketId: ticket.id,
      actorId: null,
      payload: { number: ticket.number, due: due.toISOString() },
    });
  }
}

export async function runAutoClose(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - reopenWindowMs());
  const rows = await Ticket.find({ status: "RESOLVED", resolvedAt: { $lte: cutoff } }).limit(100);
  for (const ticket of rows) {
    try {
      await applyTransition(ticket, "CLOSED", null, { reason: "Reopen window elapsed" });
    } catch (error) {
      console.error("[ticket-autoclose]", error);
    }
  }
}
