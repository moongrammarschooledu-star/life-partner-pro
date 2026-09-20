#!/usr/bin/env node
/**
 * Static security scan (STEP 15 §43). Fast, dependency-free checks that run in
 * CI. This is a guard-rail, NOT proof of security — it catches common,
 * mechanical mistakes (committed secrets, exposed env names, missing headers,
 * unsafe flags). Behavioural checks live in scripts/security-smoke.mjs and the
 * route-auth coverage unit test.
 *
 * Exit code 1 on any FAIL. With --json prints a machine-readable summary.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const results = [];
const add = (name, ok, detail) => results.push({ name, ok, detail });

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const textFiles = tracked.filter((f) => /\.(ts|tsx|js|mjs|json|md|yml|yaml|env|example|toml|css)$/.test(f) && !f.includes("package-lock.json") && !f.startsWith("prisma/migrations/"));

// 1. No .env file with real values is tracked.
const trackedEnv = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
add("No tracked .env files", trackedEnv.length === 0, trackedEnv.join(", "));

// 2. Secret patterns in tracked files.
const PATTERNS = [
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Live payment key", /\bsk_live_[A-Za-z0-9]{10,}/],
  ["Payment webhook secret", /\bwhsec_[A-Za-z0-9]{10,}/],
  ["Database URL with password", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/]{3,}@(?!localhost|127\.0\.0\.1|HOST|host|user)/],
  ["Vercel blob token", /vercel_blob_rw_[A-Za-z0-9_]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
];
const hits = [];
for (const file of textFiles) {
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  for (const [label, re] of PATTERNS) if (re.test(content)) hits.push(`${file} (${label})`);
}
add("No secrets in tracked files", hits.length === 0, hits.join("; "));

// 3. No secret-looking NEXT_PUBLIC_ variables anywhere.
const exposed = [];
for (const file of textFiles) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file) && !file.endsWith(".env.example")) continue;
  const content = readFileSync(file, "utf8");
  for (const m of content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE|API_?KEY)[A-Z0-9_]*/g)) exposed.push(`${file}: ${m[0]}`);
}
add("No secret-looking NEXT_PUBLIC_ variables", exposed.length === 0, exposed.join("; "));

// 4. Server-only configuration is not imported by client components.
const clientImportsServerConfig = [];
for (const file of tracked.filter((f) => /^src\/.*\.(ts|tsx)$/.test(f))) {
  const content = readFileSync(file, "utf8");
  if (/^["']use client["']/.test(content.trimStart()) && /@\/lib\/config\/server-config|@\/lib\/prisma["']/.test(content)) clientImportsServerConfig.push(file);
}
add("Client components never import server config or the database client", clientImportsServerConfig.length === 0, clientImportsServerConfig.join(", "));

// 5. Security headers configured; poweredBy disabled.
const nextConfig = existsSync("next.config.ts") ? readFileSync("next.config.ts", "utf8") : "";
for (const [name, re] of [
  ["poweredByHeader disabled", /poweredByHeader:\s*false/],
  ["X-Content-Type-Options set", /X-Content-Type-Options/],
  ["Referrer-Policy set", /Referrer-Policy/],
  ["Frame protection set", /X-Frame-Options|frame-ancestors/],
  ["HSTS configured", /Strict-Transport-Security/],
  ["CSP configured", /Content-Security-Policy/],
]) add(name, re.test(nextConfig), "next.config.ts");

// 6. Dangerous build/deploy flags.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scriptsText = JSON.stringify(pkg.scripts ?? {});
add("No --accept-data-loss in package scripts", !/accept-data-loss/.test(scriptsText), "");
add("Build does not run db push", !/db push/.test(pkg.scripts?.build ?? "") && !/db push/.test(pkg.scripts?.["vercel-build"] ?? ""), "");

// 7. No debug/dev flags committed in production config.
add("vercel.json has no debug env", !existsSync("vercel.json") || !/DEBUG|NODE_TLS_REJECT_UNAUTHORIZED/i.test(readFileSync("vercel.json", "utf8")), "");
const tlsOff = textFiles.filter((f) => /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/.test(readFileSync(f, "utf8")));
add("TLS verification never disabled", tlsOff.length === 0, tlsOff.join(", "));

// 8. Unsafe code patterns.
const unsafe = [];
for (const file of tracked.filter((f) => /^src\/.*\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))) {
  const c = readFileSync(file, "utf8");
  if (/dangerouslySetInnerHTML/.test(c)) unsafe.push(`${file}: dangerouslySetInnerHTML`);
  if (/\beval\(|new Function\(/.test(c)) unsafe.push(`${file}: eval/Function`);
  if (/\$queryRawUnsafe|\$executeRawUnsafe/.test(c)) unsafe.push(`${file}: raw unsafe SQL`);
}
add("No dangerouslySetInnerHTML / eval / unsafe raw SQL in application code", unsafe.length === 0, unsafe.join("; "));

const failed = results.filter((r) => !r.ok);
if (process.argv.includes("--json")) console.log(JSON.stringify({ passed: failed.length === 0, results }, null, 2));
else {
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${!r.ok && r.detail ? ` — ${r.detail}` : ""}`);
  console.log(failed.length === 0 ? "\nSecurity scan: PASS (static checks only — not proof of security)" : `\nSecurity scan: FAIL (${failed.length} issue(s))`);
}
process.exit(failed.length === 0 ? 0 : 1);
