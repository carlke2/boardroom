import cron from "node-cron";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import {
  fetchDueReminders,
  markReminderSent,
  markReminderFailed,
  sendReminderEmail,
  sendReminderSms,
} from "../services/reminders.js";

let isRunning = false;

export function startReminderCron(): void {
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

          if (!booking) {
            await markReminderFailed(r._id, { error: "BOOKING_NOT_FOUND" });
            console.warn(`[REMINDER] Failed reminderId=${r._id} reason=BOOKING_NOT_FOUND`);
            continue;
          }

          if (!user) {
            await markReminderFailed(r._id, { error: "USER_NOT_FOUND" });
            console.warn(`[REMINDER] Failed reminderId=${r._id} reason=USER_NOT_FOUND`);
            continue;
          }

          const who = `${user.name || "user"} (${user.email || "no-email"}, ${user.phone || "no-phone"})`;
          const details = `${booking.teamName || "team"}${
            booking.meetingTitle ? " — " + booking.meetingTitle : ""
          } | ${booking.startAt ? new Date(booking.startAt).toISOString() : "no-start"} - ${
            booking.endAt ? new Date(booking.endAt).toISOString() : "no-end"
          }`;

          console.log(`[REMINDER] ${r.type} | ${who} | ${details}`);

          try {
            const sendEmailFlag = !!user.email;
            const sendSms = !!user.phone;

            let emailRes: { ok?: boolean; error?: string; providerMessageId?: string | null } = { ok: true };
            let smsRes: { ok?: boolean; error?: string; providerMessageId?: string | null } = { ok: true };

            if (r.type === "STARTS_20") {
              if (sendEmailFlag) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (sendSms) smsRes = await sendReminderSms();
            } else if (r.type === "JOIN_NOW") {
              if (sendEmailFlag) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (process.env.JOIN_NOW_SMS === "true" && sendSms) {
                smsRes = await sendReminderSms();
              }
            } else if (r.type === "ENDING_10") {
              if (sendSms) smsRes = await sendReminderSms();
              if (process.env.ENDING_10_EMAIL === "true" && sendEmailFlag) {
                emailRes = await sendReminderEmail({ reminder: r, booking, user });
              }
            } else {
              if (sendEmailFlag) emailRes = await sendReminderEmail({ reminder: r, booking, user });
              if (sendSms) smsRes = await sendReminderSms();
            }

            const ok = emailRes.ok !== false && smsRes.ok !== false;

            if (ok) {
              await markReminderSent(r._id, {
                emailMessageId: emailRes.providerMessageId || null,
                smsMessageId: smsRes.providerMessageId || null,
              });
              console.log(`[REMINDER] Sent reminderId=${r._id}`);
            } else {
              await markReminderFailed(r._id, {
                error: emailRes.error || smsRes.error || "Send failed",
              });
              console.warn(
                `[REMINDER] Failed reminderId=${r._id} reason=${emailRes.error || smsRes.error || "unknown"}`
              );
            }
          } catch (sendErr) {
            const message = sendErr instanceof Error ? sendErr.message : "Send exception";
            await markReminderFailed(r._id, { error: message });
            console.error(`[REMINDER] Error reminderId=${r._id}:`, message);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[REMINDER-CRON] Tick error:", message);
      } finally {
        const ms = Date.now() - tickStart;
        console.log(`[REMINDER-CRON] Done in ${ms}ms`);
        isRunning = false;
      }
    },
    { timezone: tz }
  );

  console.log(`Reminder cron started (${schedule}) TZ=${tz}`);
}
