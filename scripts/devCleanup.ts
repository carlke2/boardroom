import { DEV_CLEANUP_SQL } from "./devSeed.js";

/**
 * Prints the delete statements and exits. It does not connect and does not run them.
 * The real admin is excluded by app.seed_admin_email; an empty setting matches nothing.
 */
console.log(DEV_CLEANUP_SQL);
console.log("-- not executed");
