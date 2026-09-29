import type { FilterQuery } from "mongoose";
import TeamMember from "../../models/TeamMember.js";
import type { ITicket, TicketDocument } from "../../models/Ticket.js";
import type { AuthUser } from "../../types/auth.js";
import { TicketError } from "./errors.js";

export type TicketAction =
  | "create"
  | "read"
  | "comment"
  | "reopen"
  | "list_queue"
  | "update"
  | "assign"
  | "transition"
  | "internal_note"
  | "events"
  | "metrics"
  | "config";

interface Membership {
  teamId: string;
  isLead: boolean;
}

async function memberships(userId: string): Promise<Membership[]> {
  const rows = await TeamMember.find({ userId }).lean();
  return rows.map((row) => ({ teamId: row.teamId.toString(), isLead: row.isLead }));
}

function isStaff(actor: AuthUser): boolean {
  return actor.role === "ADMIN" || actor.role === "TEAM_LEAD" || actor.role === "AGENT";
}

function leadTeamIds(actor: AuthUser, rows: Membership[]): string[] {
  if (actor.role === "ADMIN") return rows.map((row) => row.teamId);
  if (actor.role === "TEAM_LEAD") return rows.map((row) => row.teamId);
  return rows.filter((row) => row.isLead).map((row) => row.teamId);
}

export async function queueFilter(actor: AuthUser): Promise<FilterQuery<ITicket>> {
  if (actor.role === "ADMIN") return {};
  if (!isStaff(actor)) throw new TicketError(403, "Forbidden");

  const rows = await memberships(actor.id);
  const leads = leadTeamIds(actor, rows);
  const agentTeams = rows.map((row) => row.teamId).filter((id) => !leads.includes(id));
  const or: FilterQuery<ITicket>[] = [{ assigneeId: actor.id }];
  if (leads.length) or.push({ teamId: { $in: leads } });
  if (agentTeams.length) or.push({ teamId: { $in: agentTeams }, assigneeId: null });
  return { $or: or };
}

async function canRead(actor: AuthUser, ticket: TicketDocument): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  if (ticket.requesterId.toString() === actor.id) return true;
  if (!isStaff(actor)) return false;

  const rows = await memberships(actor.id);
  const teamId = ticket.teamId?.toString() ?? null;
  const leads = leadTeamIds(actor, rows);
  if (teamId && leads.includes(teamId)) return true;
  if (ticket.assigneeId?.toString() === actor.id) return true;
  if (teamId && ticket.assigneeId == null && rows.some((row) => row.teamId === teamId)) return true;
  return false;
}

export async function assertCan(
  actor: AuthUser,
  action: TicketAction,
  ticket?: TicketDocument
): Promise<void> {
  if (action === "config") {
    if (actor.role !== "ADMIN") throw new TicketError(403, "Admin only");
    return;
  }

  if (action === "list_queue" || action === "metrics") {
    if (!isStaff(actor)) throw new TicketError(403, "Forbidden");
    if (action === "metrics" && actor.role === "AGENT") {
      const rows = await memberships(actor.id);
      if (!leadTeamIds(actor, rows).length && actor.role === "AGENT") {
        throw new TicketError(403, "Forbidden");
      }
    }
    return;
  }

  if (action === "create") return;

  if (!ticket) throw new TicketError(500, "Ticket context missing");
  const readable = await canRead(actor, ticket);

  if (action === "read" || action === "comment") {
    if (!readable) throw new TicketError(403, "Forbidden");
    return;
  }

  if (action === "reopen") {
    if (ticket.requesterId.toString() === actor.id || readable) return;
    throw new TicketError(403, "Forbidden");
  }

  if (!isStaff(actor) || !readable) throw new TicketError(403, "Forbidden");

  if (action === "internal_note" || action === "update" || action === "transition" || action === "events") {
    return;
  }

  if (action === "assign") return;

  throw new TicketError(403, "Forbidden");
}

export async function assertAssigneeAllowed(
  actor: AuthUser,
  ticket: TicketDocument,
  assigneeId: string
): Promise<void> {
  await assertCan(actor, "assign", ticket);
  if (actor.role === "ADMIN") return;
  if (actor.role === "AGENT") {
    const rows = await memberships(actor.id);
    const teamId = ticket.teamId?.toString() ?? null;
    const isLeadHere = teamId != null && leadTeamIds(actor, rows).includes(teamId);
    if (!isLeadHere && assigneeId !== actor.id) {
      throw new TicketError(403, "Agents can only claim a ticket for themselves");
    }
  }

  if (actor.role === "TEAM_LEAD" || actor.role === "AGENT") {
    const rows = await memberships(actor.id);
    const teamId = ticket.teamId?.toString() ?? null;
    if (!teamId) {
      if (assigneeId !== actor.id) throw new TicketError(400, "Ticket has no team to assign within");
      return;
    }
    if (actor.role === "TEAM_LEAD" && !leadTeamIds(actor, rows).includes(teamId)) {
      throw new TicketError(403, "Forbidden");
    }
    const target = await TeamMember.findOne({ teamId, userId: assigneeId });
    if (!target && assigneeId !== actor.id) {
      throw new TicketError(400, "Assignee is not on this team");
    }
  }
}
