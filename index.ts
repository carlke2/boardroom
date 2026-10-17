import { createApp } from "./app.js";
import { getEnv, runEnvCheck } from "./config/env.js";
import { connectPostgres } from "./db/postgres.js";
import { checkAuth, checkDatabase } from "./utils/liveChecks.js";
import { listReachableIpv4 } from "./utils/reachableAddresses.js";
import { buildStartupBanner, noTrafficHint } from "./utils/startupBanner.js";

runEnvCheck();
const env = getEnv();
const app = createApp();
await connectPostgres();

// Reminder and ticket cron jobs are not started. Those tasks stay in Postgres functions.
const server = app.listen(env.PORT, env.HOST, async () => {
  const [database, auth] = await Promise.all([checkDatabase(), checkAuth()]);
  const lines = buildStartupBanner({
    host: env.HOST,
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    addresses: listReachableIpv4(),
    database,
    auth,
  });
  for (const line of lines) {
    console.log(line);
  }

  if (env.NODE_ENV === "development") {
    let hinted = false;
    const timer = setTimeout(() => {
      if (!hinted) {
        hinted = true;
        console.log(noTrafficHint(env.PORT));
      }
    }, 60_000);
    timer.unref?.();
    server.on("request", () => {
      hinted = true;
      clearTimeout(timer);
    });
  }
});
