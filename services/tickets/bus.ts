import { EventEmitter } from "node:events";

export type DomainEventName =
  | "ticket.created"
  | "ticket.assigned"
  | "ticket.resolved"
  | "ticket.closed"
  | "ticket.reopened"
  | "ticket.commented"
  | "sla.at_risk"
  | "sla.breached";

export interface DomainEvent {
  name: DomainEventName;
  ticketId: string;
  actorId: string | null;
  payload: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitDomainEvent(event: DomainEvent): void {
  bus.emit(event.name, event);
  bus.emit("*", event);
}

export function onDomainEvent(
  name: DomainEventName | "*",
  handler: (event: DomainEvent) => void
): void {
  bus.on(name, handler);
}
