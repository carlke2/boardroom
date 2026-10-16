import { runEnvCheck } from "../config/env.js";

try {
  runEnvCheck();
  console.log("env:check passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : "env:check failed");
  process.exit(1);
}
