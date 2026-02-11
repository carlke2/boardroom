// jobs/reminderCron.js
const cron = require("node-cron");
const Booking = require("../models/Booking");
const User = require("../models/User");
const {
  fetchDueReminders,
  markReminderSent,
  markReminderFailed,
  sendReminderEmail,
  sendReminderSms,
} = require("../services/reminders");

let isRunning = false;

function startReminderCron() {
  const schedule = process.env.REMINDER_CRON_SCHEDULE || "* * * * *";
  const tz = process.env.CRON_TZ || "Africa/Nairobi";

  cron.schedule(
    schedule,
    async () => {
      if (isRunning) {
        console.warn("[REMINDER-CRON] Skip: previous run still in progress");
        return;
      }

      isRunning = true;
      const tickStart = Date.now();
      const now = new Date();

      try {
        console.log(`[REMINDER-CRON] Tick ${now.toISOString()}`);

        const due = await fetchDueReminders(now);
        console.log(`[REMINDER-CRON] Due reminders: ${due.length}`);

        for (const r of due) {
          const [booking, user] = await Promise.all([
            Booking.findById(r.bookingId),
            User.findById(r.userId),
          ]);

          const who = user
            ? `${user.name || "user"} (${user.email || "no-email"}, ${user.phone || "no-phone"})`
            : "unknown user";

          const details = booking
            ? `${booking.teamName || "team"}${booking.meetingTitle ? " — " + booking.meetingTitle : ""} | ${
                booking.startAt ? new Date(booking.startAt).toISOString() : "no-start"
              } - ${booking.endAt ? new Date(booking.endAt).toISOString() : "no-end"}`
            : "booking missing";

          console.log(`[REMINDER] ${r.type} | ${who} | ${details}`);

          try {
            // Decide delivery channels. Keep your existing reminder types.
            // If your DB reminders already have channel info, switch to that.
            const sendEmail = !!user?.email;
            const sendSms = !!user?.phone;

            let emailRes = { ok: true };
            let smsRes = { ok: true };

            // Example behavior:
            // - STARTS_20 => email + sms
            // - JOIN_NOW  => email only (or both; your choice)
            // - ENDING_10 => sms only (or both; your choice)
            // Keep this mapping aligned with your existing backend logic.
            if (r.type === "STARTS_20") {
              if (sendEmail) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (sendSms) smsRes = await sendReminderSms({ reminder: r, booking, user });
            } else if (r.type === "JOIN_NOW") {
              if (sendEmail) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (process.env.JOIN_NOW_SMS === "true" && sendSms) {
                smsRes = await sendReminderSms({ reminder: r, booking, user });
              }
            } else if (r.type === "ENDING_10") {
              if (sendSms) smsRes = await sendReminderSms({ reminder: r, booking, user });
              if (process.env.ENDING_10_EMAIL === "true" && sendEmail) {
                emailRes = await sendReminderEmail({ reminder: r, booking, user });
              }
            } else {
              // default: try both if available
              if (sendEmail) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (sendSms) smsRes = await sendReminderSms({ reminder: r, booking, user });
            }

            const ok = (emailRes?.ok !== false) && (smsRes?.ok !== false);

            if (ok) {
              await markReminderSent(r._id, {
                emailMessageId: emailRes?.providerMessageId || null,
                smsMessageId: smsRes?.providerMessageId || null,
              });
              console.log(`[REMINDER] Sent  reminderId=${r._id}`);
            } else {
              await markReminderFailed(r._id, {
                error: emailRes?.error || smsRes?.error || "Send failed",
              });
              console.warn(
                `[REMINDER] Failed  reminderId=${r._id} reason=${emailRes?.error || smsRes?.error || "unknown"}`
              );
            }
          } catch (sendErr) {
            await markReminderFailed(r._id, { error: sendErr?.message || "Send exception" });
            console.error(`[REMINDER] Error reminderId=${r._id}:`, sendErr?.message || sendErr);
          }
        }
      } catch (e) {
        console.error("[REMINDER-CRON] Tick error:", e?.message || e);
      } finally {
        const ms = Date.now() - tickStart;
        console.log(`[REMINDER-CRON] Done in ${ms}ms`);
        isRunning = false;
      }
    },
    { timezone: tz }
  );

  console.log(` Reminder cron started (${schedule}) TZ=${tz}`);
}

module.exports = { startReminderCron };
