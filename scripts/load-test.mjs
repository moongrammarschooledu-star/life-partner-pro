#!/usr/bin/env node
/**
 * Configurable, dependency-free load test (STEP 15 §52). Measures latency
 * percentiles and error rate for PUBLIC GET endpoints.
 *
 *   node scripts/load-test.mjs --url http://localhost:3000 --concurrency 10 --duration 20 \
 *        --path / --path /register --path /api/health/live
 *
 * Safety: refuses any non-local target unless --allow-remote is given, and
 * refuses a production-looking host unless --allow-production is ALSO given.
 * It only sends GET requests to the paths you list. Authenticated scenarios
 * (login, admin search, matching, proposals) are NOT covered — they need real
 * credentials and are reported as not run.
 *
 * The output states what was measured. It never claims a maximum user capacity.
 */
import { parseArgs, baseUrl, printResults } from "./lib/evidence.mjs";

const args = parseArgs();
const base = baseUrl(args);
const concurrency = Math.min(200, Math.max(1, Number(args.concurrency) || 5));
const durationSec = Math.min(300, Math.max(1, Number(args.duration) || 10));
const paths = process.argv.slice(2).reduce((acc, a, i, arr) => (a === "--path" && arr[i + 1] ? [...acc, arr[i + 1]] : acc), []);
if (paths.length === 0) paths.push("/", "/register", "/api/health/live");

const host = new URL(base).hostname;
const local = ["localhost", "127.0.0.1", "::1"].includes(host);
if (!local && !args["allow-remote"]) {
  console.error(`Refusing to load-test remote host "${host}" without --allow-remote (use staging, never a shared environment by accident).`);
  process.exit(1);
}
if (!local && !/staging|preview|test|dev/i.test(host) && !args["allow-production"]) {
  console.error(`"${host}" does not look like a staging host. Add --allow-production ONLY if you truly intend to load a live site.`);
  process.exit(1);
}

const samples = [];
let errors = 0;
const statusCounts = {};
const stopAt = Date.now() + durationSec * 1000;

async function worker(id) {
  let i = id;
  while (Date.now() < stopAt) {
    const path = paths[i++ % paths.length];
    const started = performance.now();
    try {
      const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20000) });
      await res.arrayBuffer();
      samples.push(performance.now() - started);
      statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
      if (res.status >= 500) errors++;
    } catch {
      errors++;
      statusCounts.network_error = (statusCounts.network_error ?? 0) + 1;
    }
  }
}

console.log(`Load test: ${concurrency} concurrent workers for ${durationSec}s against ${base} → ${paths.join(", ")}`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

samples.sort((a, b) => a - b);
const pct = (p) => (samples.length ? samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))] : NaN);
const total = samples.length + (statusCounts.network_error ?? 0);
const results = [
  { name: "Requests completed", status: "PASS", detail: `${samples.length} in ${durationSec}s (${(samples.length / durationSec).toFixed(1)} req/s)` },
  { name: "Latency p50 / p95 / p99", status: "PASS", detail: `${pct(50).toFixed(0)} / ${pct(95).toFixed(0)} / ${pct(99).toFixed(0)} ms` },
  { name: "Error rate (5xx + network)", status: errors / Math.max(1, total) > 0.01 ? "WARN" : "PASS", detail: `${errors}/${total} (${((errors / Math.max(1, total)) * 100).toFixed(2)}%)` },
  { name: "Status codes", status: "PASS", detail: JSON.stringify(statusCounts) },
  { name: "Authenticated scenarios (login, admin search, matching, proposals, notifications)", status: "NOT_RUN", detail: "need real credentials; not covered here" },
];
printResults("Load test results", results);
console.log("\nNote: these numbers describe THIS run on THIS target only. They are not a capacity guarantee.");
