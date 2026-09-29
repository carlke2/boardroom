import cron from "node-cron";
import { runAutoClose, runSlaPass } from "../services/tickets/ticketService.js";

let isRunning = false;

export function startTicketJobs(): void {
  const schedule = process.env.TICKET_CRON_SCHEDULE || "*/5 * * * *";
  const tz = process.env.CRON_TZ || "Africa/Nairobi";

  cron.schedule(
    schedule,
    async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        await runSlaPass();
        await runAutoClose();
      } catch (error) {
        console.error("[ticket-jobs]", error);
      } finally {
        isRunning = false;
      }
    },
    { timezone: tz }
  );
}
