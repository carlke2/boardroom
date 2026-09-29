import mongoose from "mongoose";
import TicketCategory from "../../models/TicketCategory.js";
import RoutingRule from "../../models/RoutingRule.js";
import Team from "../../models/Team.js";
import TeamMember from "../../models/TeamMember.js";
import Ticket from "../../models/Ticket.js";
import { ACTIVE_STATUSES, type AssignStrategy, type TicketChannel, type TicketPriority } from "../../types/tickets.js";
import { dueDatesFor } from "./sla.js";

export interface TriageInput {
  subject: string;
  description: string;
  channel: TicketChannel;
  categoryId?: string | null;
  priority?: TicketPriority | null;
  teamId?: string | null;
  assigneeId?: string | null;
}

export interface TriageResult {
  categoryId: string | null;
  priority: TicketPriority;
  teamId: string | null;
  assigneeId: string | null;
  slaResponseDue: Date | null;
  slaResolutionDue: Date | null;
}

async function pickAssignee(teamId: string, strategy: AssignStrategy): Promise<string | null> {
  if (strategy === "MANUAL") return null;
  const members = await TeamMember.find({ teamId }).sort({ createdAt: 1 });
  if (!members.length) return null;

  if (strategy === "LEAST_LOADED") {
    let chosen = members[0];
    let chosenCount = Number.POSITIVE_INFINITY;
    for (const member of members) {
      const count = await Ticket.countDocuments({
        assigneeId: member.userId,
        status: { $in: ACTIVE_STATUSES },
      });
      if (count < chosenCount) {
        chosen = member;
        chosenCount = count;
      }
    }
    return chosen ? chosen.userId.toString() : null;
  }

  const team = await Team.findById(teamId);
  if (!team) return members[0]?.userId.toString() ?? null;
  const index = team.rrIndex % members.length;
  team.rrIndex = index + 1;
  await team.save();
  return members[index]?.userId.toString() ?? null;
}

export async function triageTicket(input: TriageInput, now: Date): Promise<TriageResult> {
  const rules = await RoutingRule.find({ active: true }).sort({ order: 1, createdAt: 1 });
  const haystack = `${input.subject}\n${input.description}`.toLowerCase();
  const rule = rules.find((candidate) => {
    if (candidate.channel && candidate.channel !== input.channel) return false;
    if (candidate.keyword && !haystack.includes(candidate.keyword.toLowerCase())) return false;
    return true;
  });

  let categoryId = input.categoryId || rule?.categoryId?.toString() || null;
  let priority = input.priority || rule?.priority || null;
  let teamId = input.teamId || rule?.teamId?.toString() || null;
  let assigneeId = input.assigneeId || null;

  if (categoryId && mongoose.isValidObjectId(categoryId)) {
    const category = await TicketCategory.findById(categoryId);
    if (category) {
      if (!priority) priority = category.defaultPriority;
      if (!teamId && category.defaultTeamId) teamId = category.defaultTeamId.toString();
    } else {
      categoryId = null;
    }
  } else {
    categoryId = null;
  }

  if (!priority) priority = "MEDIUM";

  if (!assigneeId && teamId && rule && rule.assignStrategy !== "MANUAL") {
    assigneeId = await pickAssignee(teamId, rule.assignStrategy);
  }

  const due = await dueDatesFor(now, priority);
  return {
    categoryId,
    priority,
    teamId,
    assigneeId,
    slaResponseDue: due.response,
    slaResolutionDue: due.resolution,
  };
}
