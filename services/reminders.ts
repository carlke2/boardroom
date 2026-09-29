import type { Types } from "mongoose";
import Reminder from "../models/Reminder.js";
import type { ReminderType } from "../models/Reminder.js";
import { sendEmail } from "./notify/email.js";
import {
  buildReminderEmailSubject,
  buildReminderEmailHtml,
  buildReminderEmailText,
} from "./notify/templates.js";
import type { MailBooking } from "./notify/templates.js";

function uniqEmails(list: unknown): string[] {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item) continue;
    const email = String(item).trim().toLowerCase();
    if (!email) continue;
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

function makeReminderTimes(endAt: Date): Array<{ type: ReminderType; scheduledAt: Date }> {
  return [{ type: "ENDING_20", scheduledAt: new Date(endAt.getTime() - 20 * 60 * 1000) }];
}

export async function createRemindersForBooking(input: {
  userId: string;
  bookingId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
}): Promise<void> {
  const jobs = makeReminderTimes(input.endAt).map((r) => ({
    userId: input.userId,
    bookingId: input.bookingId,
    type: r.type,
    scheduledAt: r.scheduledAt,
    status: "PENDING" as const,
  }));
  await Reminder.insertMany(jobs);
}

export async function fetchDueReminders(now = new Date()) {
  return Reminder.find({ status: "PENDING", scheduledAt: { $lte: now } }).limit(50);
}

export async function markReminderSent(reminderId: Types.ObjectId, meta: Record<string, unknown> = {}) {
  return Reminder.findByIdAndUpdate(
    reminderId,
    {
      status: "SENT",
      sentAt: new Date(),
      lastError: null,
      meta,
    },
    { new: true }
  );
}

export async function markReminderFailed(reminderId: Types.ObjectId, meta: Record<string, unknown> = {}) {
  return Reminder.findByIdAndUpdate(
    reminderId,
    {
      status: "FAILED",
      failedAt: new Date(),
      lastError: typeof meta.error === "string" ? meta.error : "FAILED",
      meta,
    },
    { new: true }
  );
}

export async function cancelRemindersForBooking(bookingId: Types.ObjectId): Promise<void> {
  await Reminder.updateMany({ bookingId }, { status: "CANCELLED" });
}

export async function sendReminderEmail(input: {
  reminder: { type?: string };
  booking: MailBooking & { attendees?: string[] };
  user?: { email?: string; name?: string } | null;
}): Promise<{ ok: boolean; error?: string; providerMessageId: string | null }> {
  const attendees = uniqEmails(input.booking.attendees);
  const fallback = uniqEmails(input.user?.email);
  const recipients = attendees.length ? attendees : fallback;
  if (!recipients.length) return { ok: false, error: "NO_EMAIL_RECIPIENTS", providerMessageId: null };

  const subject = buildReminderEmailSubject({ booking: input.booking, type: input.reminder.type });

  for (const email of recipients) {
    const html = buildReminderEmailHtml({
      recipientName: null,
      booking: input.booking,
      type: input.reminder.type,
    });
    const text = buildReminderEmailText({
      recipientName: null,
      booking: input.booking,
      type: input.reminder.type,
    });

    const res = await sendEmail({ to: email, subject, html, text });
    if (!res.ok) {
      const reason = typeof res.error === "string" ? res.error : "unknown";
      return { ok: false, error: `EMAIL_FAILED:${email}:${reason}`, providerMessageId: null };
    }
  }

  return { ok: true, providerMessageId: null };
}

export async function sendReminderSms(): Promise<{ ok: true; providerMessageId: null }> {
  return { ok: true, providerMessageId: null };
}
