import Notification from "../../models/Notification.js";
import TeamMember from "../../models/TeamMember.js";
import Ticket from "../../models/Ticket.js";
import User from "../../models/User.js";
import { sendEmail } from "../notify/email.js";
import { onDomainEvent, type DomainEvent } from "./bus.js";

let registered = false;

async function notifyUser(userId: string, type: string, title: string, body: string, ticketId: string) {
  await Notification.create({ userId, type, title, body, ticketId });
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;
  const user = await User.findById(userId).select("email name");
  if (!user?.email) return;
  try {
    await sendEmail({ to: user.email, subject: title, text: `${body}\n` });
  } catch (error) {
    console.error("[ticket-email]", error);
  }
}

async function slack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.error("[ticket-slack]", error);
  }
}

async function leadIds(teamId: string | null): Promise<string[]> {
  if (!teamId) return [];
  const leads = await TeamMember.find({ teamId, isLead: true }).select("userId");
  return leads.map((lead) => lead.userId.toString());
}

async function handle(event: DomainEvent): Promise<void> {
  const ticket = await Ticket.findById(event.ticketId).select(
    "number subject requesterId assigneeId teamId"
  );
  if (!ticket) return;
  const number = ticket.number;
  const requesterId = ticket.requesterId.toString();
  const assigneeId = ticket.assigneeId?.toString() ?? null;

  if (event.name === "ticket.created") {
    await notifyUser(requesterId, event.name, `${number} received`, ticket.subject, ticket.id);
  } else if (event.name === "ticket.assigned" && assigneeId && assigneeId !== event.actorId) {
    await notifyUser(assigneeId, event.name, `${number} assigned to you`, ticket.subject, ticket.id);
  } else if (event.name === "ticket.commented" && event.payload.isInternal !== true) {
    if (event.actorId !== requesterId) {
      await notifyUser(requesterId, event.name, `Reply on ${number}`, ticket.subject, ticket.id);
    }
  } else if (event.name === "ticket.commented" && event.payload.isInternal === true && assigneeId) {
    if (assigneeId !== event.actorId) {
      await notifyUser(assigneeId, event.name, `Internal note on ${number}`, ticket.subject, ticket.id);
    }
  } else if (event.name === "ticket.resolved") {
    await notifyUser(
      requesterId,
      event.name,
      `${number} resolved`,
      "You can confirm the resolution or reopen it from the ticket.",
      ticket.id
    );
  } else if (event.name === "sla.at_risk" || event.name === "sla.breached") {
    const targets = new Set<string>(await leadIds(ticket.teamId?.toString() ?? null));
    if (assigneeId) targets.add(assigneeId);
    for (const userId of targets) {
      await notifyUser(userId, event.name, `${number} ${event.name}`, ticket.subject, ticket.id);
    }
  }

  await slack(`${event.name} ${number}: ${ticket.subject}`);
}

export function registerTicketNotifications(): void {
  if (registered) return;
  registered = true;
  onDomainEvent("*", (event) => {
    void handle(event).catch((error) => console.error("[ticket-notify]", error));
  });
}
