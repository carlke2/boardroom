const Reminder = require("../models/Reminder");

function makeReminderTimes(startAt, endAt) {
  return [
    { type: "STARTS_20", scheduledAt: new Date(startAt.getTime() - 20 * 60 * 1000) },
    { type: "JOIN_NOW", scheduledAt: new Date(startAt.getTime()) },
    { type: "ENDING_10", scheduledAt: new Date(endAt.getTime() - 10 * 60 * 1000) }
  ];
}

async function createRemindersForBooking({ userId, bookingId, startAt, endAt }) {
  const jobs = makeReminderTimes(startAt, endAt).map((r) => ({
    userId,
    bookingId,
    type: r.type,
    scheduledAt: r.scheduledAt,
    status: "PENDING"
  }));
  await Reminder.insertMany(jobs);
}

async function fetchDueReminders(now = new Date()) {
  return Reminder.find({ status: "PENDING", scheduledAt: { $lte: now } }).limit(50);
}

async function markReminderSent(reminderId) {
  return Reminder.findByIdAndUpdate(
    reminderId,
    { status: "SENT", sentAt: new Date() },
    { new: true }
  );
}

async function cancelRemindersForBooking(bookingId) {
  await Reminder.updateMany({ bookingId }, { status: "CANCELLED" });
}

module.exports = { createRemindersForBooking, fetchDueReminders, markReminderSent, cancelRemindersForBooking };
