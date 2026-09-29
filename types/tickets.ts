export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "PENDING_CUSTOMER",
  "ON_HOLD",
  "RESOLVED",
  "REOPENED",
  "CLOSED",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CHANNELS = ["API", "WEB", "AGENT", "EMAIL", "SYSTEM"] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export const LINK_TYPES = ["duplicate", "blocks", "related"] as const;
export type TicketLinkType = (typeof LINK_TYPES)[number];

export const ASSIGN_STRATEGIES = ["MANUAL", "ROUND_ROBIN", "LEAST_LOADED"] as const;
export type AssignStrategy = (typeof ASSIGN_STRATEGIES)[number];

export const ACTIVE_STATUSES: TicketStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "PENDING_CUSTOMER",
  "ON_HOLD",
  "REOPENED",
];

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketPriority(value: string): value is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketChannel(value: string): value is TicketChannel {
  return (TICKET_CHANNELS as readonly string[]).includes(value);
}
