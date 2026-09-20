#!/usr/bin/env node
/**
 * Dependency audit gate (STEP 15 §43/§44). Fails on any HIGH/CRITICAL advisory in
 * production dependencies unless it is listed in audit-allowlist.json with a
 * reason and an unexpired review-by date. Moderate/low findings are reported
 * but do not fail. Major dependency upgrades are never automatic.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const r = spawnSync(npm, ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
let report;
try { report = JSON.parse(r.stdout); } catch { console.error("Could not read npm audit output (offline?)."); process.exit(1); }

const allow = new Map(JSON.parse(readFileSync("audit-allowlist.json", "utf8")).allow.map((a) => [a.package, a]));
const today = new Date().toISOString().slice(0, 10);
let failed = 0;
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  const gate = v.severity === "high" || v.severity === "critical";
  const entry = allow.get(name);
  const allowed = entry && entry.reviewBy >= today;
  const tag = !gate ? "note " : allowed ? "allow" : "FAIL ";
  if (gate && !allowed) failed++;
  console.log(`${tag} ${v.severity.padEnd(8)} ${name}${entry ? (allowed ? "  (reviewed exception)" : "  (exception EXPIRED)") : ""}`);
}
const total = report.metadata?.vulnerabilities ?? {};
console.log(`\n${failed === 0 ? "Dependency audit: PASS" : `Dependency audit: FAIL (${failed} unreviewed high/critical)`} — totals: ${JSON.stringify(total)}`);
process.exit(failed === 0 ? 0 : 1);
