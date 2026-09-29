import type { FilterQuery, PipelineStage } from "mongoose";
import Ticket from "../../models/Ticket.js";
import type { ITicket } from "../../models/Ticket.js";
import CsatResponse from "../../models/CsatResponse.js";
import TeamMember from "../../models/TeamMember.js";
import type { AuthUser } from "../../types/auth.js";
import { ACTIVE_STATUSES } from "../../types/tickets.js";
import { TicketError } from "./errors.js";
import { assertCan } from "./policy.js";
import { slaRiskWindowMs } from "./sla.js";

async function scope(actor: AuthUser): Promise<FilterQuery<ITicket>> {
  await assertCan(actor, "metrics");
  if (actor.role === "ADMIN") return {};
  const rows = await TeamMember.find({ userId: actor.id }).lean();
  const teamIds =
    actor.role === "TEAM_LEAD"
      ? rows.map((row) => row.teamId)
      : rows.filter((row) => row.isLead).map((row) => row.teamId);
  return { teamId: { $in: teamIds } };
}

function minutes(ms: number | null | undefined): number | null {
  if (ms == null || Number.isNaN(ms)) return null;
  return Math.round(ms / 60000);
}

export async function metricsSummary(actor: AuthUser) {
  const match = await scope(actor);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const active = { ...match, status: { $in: ACTIVE_STATUSES } };

  const [open, unassigned, overdue, resolvedToday, responseRows, resolutionRows] = await Promise.all([
    Ticket.countDocuments(active),
    Ticket.countDocuments({ ...active, assigneeId: null }),
    Ticket.countDocuments({ ...active, slaPausedAt: null, slaResolutionDue: { $lt: now } }),
    Ticket.countDocuments({ ...match, resolvedAt: { $gte: start } }),
    Ticket.aggregate<{ avg: number | null }>([
      { $match: { ...match, firstResponseAt: { $ne: null } } },
      { $project: { ms: { $subtract: ["$firstResponseAt", "$createdAt"] } } },
      { $group: { _id: null, avg: { $avg: "$ms" } } },
    ]),
    Ticket.aggregate<{ avg: number | null }>([
      { $match: { ...match, resolvedAt: { $ne: null } } },
      { $project: { ms: { $subtract: ["$resolvedAt", "$createdAt"] } } },
      { $group: { _id: null, avg: { $avg: "$ms" } } },
    ]),
  ]);

  return {
    open,
    unassigned,
    overdue,
    resolvedToday,
    averageFirstResponseMinutes: minutes(responseRows[0]?.avg),
    averageResolutionMinutes: minutes(resolutionRows[0]?.avg),
  };
}

async function grouped(actor: AuthUser, field: string) {
  const match = await scope(actor);
  const rows = await Ticket.aggregate<{ _id: string | null; count: number }>([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ id: row._id, count: row.count }));
}

export async function metricsByStatus(actor: AuthUser) {
  return grouped(actor, "status");
}

export async function metricsByPriority(actor: AuthUser) {
  return grouped(actor, "priority");
}

export async function metricsByCategory(actor: AuthUser) {
  const match = await scope(actor);
  const rows = await Ticket.aggregate<{ _id: string | null; count: number; name?: string }>([
    { $match: match },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    {
      $lookup: {
        from: "ticketcategories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $project: {
        count: 1,
        name: { $ifNull: [{ $arrayElemAt: ["$category.name", 0] }, "Uncategorized"] },
      },
    },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ id: row._id, name: row.name, count: row.count }));
}

export async function metricsByAgent(actor: AuthUser) {
  const match = await scope(actor);
  const rows = await Ticket.aggregate<{ _id: string | null; count: number; name?: string }>([
    { $match: { ...match, assigneeId: { $ne: null } } },
    { $group: { _id: "$assigneeId", count: { $sum: 1 } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    {
      $project: {
        count: 1,
        name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, "Unknown"] },
      },
    },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ id: row._id, name: row.name, count: row.count }));
}

export async function metricsTrend(actor: AuthUser, fromRaw: string, toRaw: string, interval: string) {
  if (interval && interval !== "day") throw new TicketError(400, "interval must be day");
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (!fromRaw || !toRaw || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new TicketError(400, "from and to must be valid ISO dates");
  }
  const match = await scope(actor);
  const timezone = process.env.CRON_TZ || "Africa/Nairobi";
  const bucket = { $dateToString: { format: "%Y-%m-%d", timezone } };

  const [created, resolved] = await Promise.all([
    Ticket.aggregate<{ _id: string; count: number }>([
      { $match: { ...match, createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: { ...bucket, date: "$createdAt" }, count: { $sum: 1 } } },
    ]),
    Ticket.aggregate<{ _id: string; count: number }>([
      { $match: { ...match, resolvedAt: { $gte: from, $lt: to } } },
      { $group: { _id: { ...bucket, date: "$resolvedAt" }, count: { $sum: 1 } } },
    ]),
  ]);

  const days = new Map<string, { date: string; created: number; resolved: number }>();
  for (const row of created) {
    days.set(row._id, { date: row._id, created: row.count, resolved: 0 });
  }
  for (const row of resolved) {
    const existing = days.get(row._id) ?? { date: row._id, created: 0, resolved: 0 };
    existing.resolved = row.count;
    days.set(row._id, existing);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function metricsSla(actor: AuthUser) {
  const match = await scope(actor);
  const now = new Date();
  const horizon = new Date(now.getTime() + slaRiskWindowMs());
  const active = { ...match, status: { $in: ACTIVE_STATUSES }, slaPausedAt: null };

  const [compliance, breaches, atRisk] = await Promise.all([
    Ticket.aggregate<{ total: number; met: number }>([
      { $match: { ...match, resolvedAt: { $ne: null }, slaResolutionDue: { $ne: null } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          met: { $sum: { $cond: [{ $lte: ["$resolvedAt", "$slaResolutionDue"] }, 1, 0] } },
        },
      },
    ]),
    Ticket.countDocuments({ ...active, slaResolutionDue: { $lt: now } }),
    Ticket.find({ ...active, slaResolutionDue: { $gte: now, $lte: horizon } })
      .select("number subject priority status assigneeId teamId slaResolutionDue")
      .sort({ slaResolutionDue: 1 })
      .limit(50),
  ]);

  const total = compliance[0]?.total ?? 0;
  const met = compliance[0]?.met ?? 0;
  return {
    compliancePercent: total ? Math.round((met / total) * 1000) / 10 : null,
    met,
    measured: total,
    breaches,
    atRisk,
  };
}

export async function metricsWorkload(actor: AuthUser) {
  const match = await scope(actor);
  const active = { ...match, status: { $in: ACTIVE_STATUSES } };
  const [agents, teams] = await Promise.all([
    Ticket.aggregate<{ _id: string; open: number; name?: string }>([
      { $match: { ...active, assigneeId: { $ne: null } } },
      { $group: { _id: "$assigneeId", open: { $sum: 1 } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $project: { open: 1, name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, "Unknown"] } } },
      { $sort: { open: -1 } },
    ]),
    Ticket.aggregate<{ _id: string | null; open: number; name?: string }>([
      { $match: { ...active, teamId: { $ne: null } } },
      { $group: { _id: "$teamId", open: { $sum: 1 } } },
      { $lookup: { from: "teams", localField: "_id", foreignField: "_id", as: "team" } },
      { $project: { open: 1, name: { $ifNull: [{ $arrayElemAt: ["$team.name", 0] }, "Unknown"] } } },
      { $sort: { open: -1 } },
    ]),
  ]);
  return {
    agents: agents.map((row) => ({ id: row._id, name: row.name, open: row.open })),
    teams: teams.map((row) => ({ id: row._id, name: row.name, open: row.open })),
  };
}

export async function metricsCsat(actor: AuthUser) {
  const match = await scope(actor);
  const teamFilter = "teamId" in match ? match.teamId : undefined;
  const pipeline: PipelineStage[] = [
    { $lookup: { from: "tickets", localField: "ticketId", foreignField: "_id", as: "ticket" } },
    { $unwind: "$ticket" },
  ];
  if (teamFilter && typeof teamFilter === "object") {
    pipeline.push({ $match: { "ticket.teamId": teamFilter } } as PipelineStage);
  }
  pipeline.push({ $group: { _id: null, average: { $avg: "$score" }, count: { $sum: 1 } } });
  const rows = await CsatResponse.aggregate<{ average: number; count: number }>(pipeline);
  return {
    average: rows[0] ? Math.round(rows[0].average * 10) / 10 : null,
    count: rows[0]?.count ?? 0,
  };
}
