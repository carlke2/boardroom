/**
 * Read-only connectivity check. Prints PASS/FAIL with fixes. Changes nothing.
 * Never prints secrets, tokens, or request bodies.
 */
import { execFileSync } from "node:child_process";
import { getEnv, runEnvCheck } from "../config/env.js";
import { listReachableIpv4 } from "../utils/reachableAddresses.js";

runEnvCheck();
const env = getEnv();
const port = env.PORT;
const host = env.HOST;

type Row = { label: string; pass: boolean; detail: string };

const rows: Row[] = [];

function add(label: string, pass: boolean, detail: string): void {
  rows.push({ label, pass, detail });
}

console.log("=== net:check (read-only) ===");
console.log(`Configured HOST=${host} PORT=${port}`);

const addresses = listReachableIpv4();
if (addresses.length === 0) {
  console.log("IPv4 (LAN): none found on non-virtual interfaces");
} else {
  console.log("IPv4 (LAN):");
  for (const item of addresses) {
    console.log(`  ${item.address}  (${item.name})`);
  }
}

function portBoundToAllInterfaces(): { bound: boolean; detail: string } {
  try {
    const out = execFileSync("ss", ["-ltn"], { encoding: "utf8" });
    const lines = out.split("\n");
    const hit = lines.find((line) => {
      if (!line.includes(`:${port}`)) return false;
      return /LISTEN/.test(line);
    });
    if (!hit) {
      return {
        bound: false,
        detail: `Nothing listening on port ${port}. Start the API (npm run dev) first.`,
      };
    }
    const onAll = hit.includes(`0.0.0.0:${port}`) || hit.includes(`*:${port}`) || hit.includes(`[::]:${port}`);
    if (onAll || host === "0.0.0.0" || host === "::") {
      // Confirm address column
      if (hit.includes(`0.0.0.0:${port}`) || hit.includes(`*:${port}`)) {
        return { bound: true, detail: `Port ${port} is bound on 0.0.0.0 (or *)` };
      }
      if (hit.includes(`127.0.0.1:${port}`)) {
        return {
          bound: false,
          detail: `Port ${port} is bound to 127.0.0.1 only. Set HOST=0.0.0.0 in backend/.env and restart.`,
        };
      }
      return { bound: true, detail: hit.trim().slice(0, 120) };
    }
    if (hit.includes(`127.0.0.1:${port}`)) {
      return {
        bound: false,
        detail: `Port ${port} is bound to 127.0.0.1 only. Set HOST=0.0.0.0 in backend/.env and restart.`,
      };
    }
    return { bound: true, detail: hit.trim().slice(0, 120) };
  } catch {
    return {
      bound: false,
      detail: `Could not run ss. Install iproute2 or check manually that HOST=0.0.0.0.`,
    };
  }
}

const bind = portBoundToAllInterfaces();
add("bind 0.0.0.0", bind.bound, bind.detail);

try {
  const ufw = execFileSync("ufw", ["status"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const first = ufw.split("\n")[0] || ufw;
  const inactive = /inactive/i.test(ufw);
  const allows =
    inactive ||
    new RegExp(`\\b${port}\\b`).test(ufw) ||
    /ALLOW\s+Anywhere/i.test(ufw);
  add(
    "ufw",
    allows,
    inactive
      ? `${first} (firewall inactive)`
      : allows
        ? first
        : `${first}. Allow inbound TCP ${port}: sudo ufw allow ${port}/tcp`
  );
  console.log(`ufw: ${first}`);
} catch {
  add("ufw", true, "ufw not installed or not permitted (skipped)");
  console.log("ufw: unavailable (skipped)");
}

async function probe(url: string): Promise<{ ok: boolean; status: number; reason: string }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return { ok: true, status: response.status, reason: `HTTP ${response.status}` };
    return {
      ok: false,
      status: response.status,
      reason: `HTTP ${response.status}. If 503, database or auth check failed; see server banner.`,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : "connection failed";
    return {
      ok: false,
      status: 0,
      reason: `${reason}. Confirm the API is running and HOST=0.0.0.0.`,
    };
  }
}

const targets = [
  `http://127.0.0.1:${port}/health`,
  ...addresses.map((a) => `http://${a.address}:${port}/health`),
];

for (const url of targets) {
  const result = await probe(url);
  add(`curl ${url}`, result.ok, result.reason);
}

console.log("");
for (const row of rows) {
  const mark = row.pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${row.label} — ${row.detail}`);
}

const failed = rows.filter((r) => !r.pass).length;
console.log("");
console.log(failed === 0 ? "net:check complete: all PASS" : `net:check complete: ${failed} FAIL`);
process.exitCode = failed === 0 ? 0 : 1;
