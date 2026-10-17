import assert from "node:assert/strict";
import test from "node:test";
import { listReachableIpv4, reachableAtLines } from "../utils/reachableAddresses.js";
import { buildStartupBanner, noTrafficHint } from "../utils/startupBanner.js";
import { trustProxySetting, parseEnv } from "../config/env.js";
import { validEnvInput } from "./fixture.js";

test("listReachableIpv4 skips internal, docker, and virtual interfaces", () => {
  const found = listReachableIpv4({
    lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: null }],
    docker0: [
      { address: "172.17.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: null },
    ],
    "br-abc": [
      { address: "172.18.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: null },
    ],
    wlp2s0: [
      { address: "10.0.0.5", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: null },
    ],
    eth0: [
      { address: "192.168.1.10", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: null },
    ],
  });
  assert.deepEqual(
    found.map((f) => f.address),
    ["10.0.0.5", "192.168.1.10"]
  );
});

test("buildStartupBanner includes host, port, reachable lines, and check results", () => {
  const lines = buildStartupBanner({
    host: "0.0.0.0",
    port: 5000,
    nodeEnv: "development",
    addresses: [{ name: "wlp2s0", address: "10.0.0.5" }],
    database: { ok: true },
    auth: { ok: false, reason: "Supabase Auth unreachable" },
  });
  assert.ok(lines.some((l) => l.includes("0.0.0.0:5000")));
  assert.ok(lines.some((l) => l === "NODE_ENV=development"));
  assert.ok(lines.some((l) => l === "Reachable at http://10.0.0.5:5000"));
  assert.ok(lines.some((l) => l === "database: ok"));
  assert.ok(lines.some((l) => l.includes("auth: FAIL") && l.includes("Supabase Auth unreachable")));
  assert.equal(lines.join("\n").includes("eyJ"), false);
  assert.equal(reachableAtLines(5000, [{ name: "a", address: "1.2.3.4" }])[0], "Reachable at http://1.2.3.4:5000");
  assert.match(noTrafficHint(5000), /firewall allows 5000/);
});

test("trustProxySetting reads from env and never hardcodes", () => {
  assert.equal(trustProxySetting(parseEnv({ ...validEnvInput, TRUST_PROXY: "false" })), false);
  assert.equal(trustProxySetting(parseEnv({ ...validEnvInput, TRUST_PROXY: "true" })), 1);
  assert.equal(trustProxySetting(parseEnv({ ...validEnvInput, TRUST_PROXY: "2" })), 2);
});
