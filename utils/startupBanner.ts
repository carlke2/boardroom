import type { LiveCheck } from "./liveChecks.js";
import { reachableAtLines, type NetworkAddress } from "./reachableAddresses.js";

export interface BannerInput {
  host: string;
  port: number;
  nodeEnv: string;
  addresses: NetworkAddress[];
  database: LiveCheck;
  auth: LiveCheck;
}

/** Builds startup lines. Pure; safe to unit test. Never includes secrets. */
export function buildStartupBanner(input: BannerInput): string[] {
  const lines: string[] = [
    `Listening on ${input.host}:${input.port}`,
    `NODE_ENV=${input.nodeEnv}`,
  ];
  const reachable = reachableAtLines(input.port, input.addresses);
  if (reachable.length === 0) {
    lines.push("Reachable at (no non-internal IPv4 found on physical interfaces)");
  } else {
    lines.push(...reachable);
  }
  lines.push(formatCheck("database", input.database));
  lines.push(formatCheck("auth", input.auth));
  return lines;
}

function formatCheck(name: string, check: LiveCheck): string {
  if (check.ok) return `${name}: ok`;
  return `${name}: FAIL — ${check.reason}`;
}

export function noTrafficHint(port: number): string {
  return (
    `No requests yet. If the phone cannot connect, check the address in mobile ` +
    `env/dev.json matches a Reachable line above, same Wi-Fi, and the firewall allows ${port}.`
  );
}
