// services/reminders.js
const Reminder = require("../models/Reminder");

// Keep your existing helpers
function makeReminderTimes(startAt, endAt) {
  return [
    { type: "STARTS_20", scheduledAt: new Date(startAt.getTime() - 20 * 60 * 1000) },
    { type: "JOIN_NOW", scheduledAt: new Date(startAt.getTime()) },
    { type: "ENDING_10", scheduledAt: new Date(endAt.getTime() - 10 * 60 * 1000) },
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

// Accept meta (your cron passes meta). If you don't need it, store it anyway.
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

// If you already have real implementations elsewhere, import them here instead.
// For now, provide stubs so cron doesn't crash.
async function sendReminderEmail({ reminder, booking, user }) {
  // TODO: integrate nodemailer/sendgrid
  return { ok: true, providerMessageId: null };
}

async function sendReminderSms({ reminder, booking, user }) {
  // TODO: integrate twilio/africastalking
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
