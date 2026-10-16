import { cleanupSql, DEFAULT_SEED_TAG, loadRosterFile } from "./seedLib.js";

/**
 * Prints delete SQL and exits. Does not connect and does not run it.
 * Pass --include-users to include Auth user deletes for tagged accounts.
 */
const includeUsers = process.argv.includes("--include-users");
let seedTag = DEFAULT_SEED_TAG;
try {
  seedTag = loadRosterFile().seedTag;
} catch {
  // Example tag when the local roster is absent.
}
console.log(cleanupSql(seedTag, includeUsers));
console.log("-- not executed");
