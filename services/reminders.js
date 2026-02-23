// services/reminders.js
const Reminder = require("../models/Reminder");

const { sendEmail } = require("./notify/email");
const {
  buildReminderEmailSubject,
  buildReminderEmailHtml,
  buildReminderEmailText,
} = require("./notify/templates");

function uniqEmails(list) {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out = [];
  const seen = new Set();
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

function makeReminderTimes(startAt, endAt) {
  // ✅ YOUR REQUIREMENT: 20 minutes before they EXIT (endAt)
  return [
    { type: "ENDING_20", scheduledAt: new Date(endAt.getTime() - 20 * 60 * 1000) },
  ];
}

async function createRemindersForBooking({ userId, bookingId, startAt, endAt }) {
  const jobs = makeReminderTimes(startAt, endAt).map((r) => ({
    userId,
    bookingId,
    type: r.type,
    scheduledAt: r.scheduledAt,
    status: "PENDING",
  }));
  await Reminder.insertMany(jobs);
}

async function fetchDueReminders(now = new Date()) {
  return Reminder.find({ status: "PENDING", scheduledAt: { $lte: now } }).limit(50);
}

async function markReminderSent(reminderId, meta = {}) {
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

async function markReminderFailed(reminderId, meta = {}) {
  return Reminder.findByIdAndUpdate(
    reminderId,
    {
      status: "FAILED",
      failedAt: new Date(),
      lastError: meta?.error || "FAILED",
      meta,
    },
    { new: true }
  );
}

async function cancelRemindersForBooking(bookingId) {
  await Reminder.updateMany({ bookingId }, { status: "CANCELLED" });
}

async function sendReminderEmail({ reminder, booking, user }) {
  // Send to ALL attendees; fallback to booking owner email if none
  const attendees = uniqEmails(booking?.attendees);
  const fallback = uniqEmails(user?.email);

  const recipients = attendees.length ? attendees : fallback;
  if (!recipients.length) return { ok: false, error: "NO_EMAIL_RECIPIENTS" };

  const subject = buildReminderEmailSubject({ booking, type: reminder.type });

  for (const email of recipients) {
    const html = buildReminderEmailHtml({ recipientName: null, booking, type: reminder.type });
    const text = buildReminderEmailText({ recipientName: null, booking, type: reminder.type });

    const res = await sendEmail({ to: email, subject, html, text });
    if (!res.ok) return { ok: false, error: `EMAIL_FAILED:${email}:${res.error || "unknown"}` };
  }

  return { ok: true, providerMessageId: null };
}

// SMS not required for your need, keep stable
async function sendReminderSms() {
  return { ok: true, providerMessageId: null };
}

module.exports = {
  createRemindersForBooking,
  fetchDueReminders,
  markReminderSent,
  markReminderFailed,
  cancelRemindersForBooking,
  sendReminderEmail,
  sendReminderSms,
};
