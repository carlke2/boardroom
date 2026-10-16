import { createApp } from "./app.js";
import { getEnv, runEnvCheck } from "./config/env.js";
import { connectPostgres } from "./db/postgres.js";

runEnvCheck();
const env = getEnv();
const app = createApp();
await connectPostgres();

// Reminder and ticket cron jobs are not started. Those tasks stay in Postgres functions.
app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
