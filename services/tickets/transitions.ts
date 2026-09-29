import type { TicketStatus } from "../../types/tickets.js";

const ALLOWED: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ["OPEN"],
  OPEN: ["IN_PROGRESS", "PENDING_CUSTOMER", "ON_HOLD", "RESOLVED"],
  IN_PROGRESS: ["OPEN", "PENDING_CUSTOMER", "ON_HOLD", "RESOLVED"],
  PENDING_CUSTOMER: ["OPEN", "IN_PROGRESS"],
  ON_HOLD: ["OPEN", "IN_PROGRESS"],
  RESOLVED: ["REOPENED", "CLOSED"],
  REOPENED: ["OPEN"],
  CLOSED: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTargets(from: TicketStatus): readonly TicketStatus[] {
  return ALLOWED[from];
}
