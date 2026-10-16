import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const banned = new RegExp(["mong", "oose"].join("") + "|" + ["mon", "go"].join(""), "i");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name === "package.json") found.push(full);
  }
  return found;
}

test("source and package.json do not mention the removed document client", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    if (banned.test(text)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, []);
});
