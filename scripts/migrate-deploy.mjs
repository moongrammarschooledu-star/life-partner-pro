#!/usr/bin/env node
/**
 * Safe database migration runner (STEP 15 §5). Used by `vercel-build`
 * (`npm run vercel-build`) and by hand (`npm run db:migrate:deploy|status`).
 *
 *  - Runs `prisma migrate deploy` (applies ONLY committed, versioned migrations;
 *    never `db push`, never `--accept-data-loss`).
 *  - Aborts if the database's environment label contradicts this deployment's
 *    environment (a preview build must never migrate the production database).
 *  - Aborts if any migration contains destructive SQL without a written approval
 *    file (see scripts/check-migrations.mjs).
 *  - Migrations run over a DIRECT (un-pooled) connection: Prisma takes an
 *    advisory lock, which Neon's pooled (pgbouncer) endpoint does not support.
 *  - A failed migration fails the build, so the previous deployment keeps serving.
 *
 * Usage:  node scripts/migrate-deploy.mjs [--status]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const statusOnly = process.argv.includes("--status");

if (process.argv.some((a) => /accept-data-loss/i.test(a))) {
  console.error("Refusing: --accept-data-loss is not permitted. Destructive changes need an explicit, approved migration.");
  process.exit(1);
}

if (existsSync(".env") && !process.env.DATABASE_URL && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

function resolveAppEnv() {
  const explicit = process.env.APP_ENV?.toLowerCase();
  if (["development", "staging", "production"].includes(explicit)) return explicit;
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "staging";
  return "development";
}

const appEnv = resolveAppEnv();
const label = process.env.DATABASE_ENV_LABEL?.trim().toLowerCase();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (label && label !== appEnv) {
  console.error(`ABORT: DATABASE_ENV_LABEL is "${label}" but this is a "${appEnv}" deployment. Environments must never be mixed.`);
  process.exit(1);
}
if (!label && appEnv !== "development") {
  console.warn(`WARNING: DATABASE_ENV_LABEL is not set for the "${appEnv}" environment — cannot prove this database belongs to it. Production Readiness will show BLOCKED until it is set.`);
}

// Destructive-migration guard.
const check = spawnSync(process.execPath, ["scripts/check-migrations.mjs"], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status ?? 1);

const direct = new URL(url);
direct.hostname = direct.hostname.replace("-pooler", "");
direct.searchParams.delete("pgbouncer");

const prismaCli = require.resolve("prisma/build/index.js");
function prisma(args) {
  return spawnSync(process.execPath, [prismaCli, ...args], { stdio: "inherit", env: { ...process.env, DATABASE_URL: direct.toString() } });
}

if (!statusOnly) {
  console.log(`Applying migrations to the "${appEnv}" database…`);
  const deploy = prisma(["migrate", "deploy"]);
  if (deploy.status !== 0) {
    console.error("\nMIGRATION FAILED — the build is stopped so the previous version keeps serving. Nothing was rolled forward blindly.");
    console.error("If this database was created with `db push` and has no migration history, baseline it once with:");
    console.error("  npx prisma migrate resolve --applied 0_init");
    process.exit(deploy.status ?? 1);
  }
}

const status = prisma(["migrate", "status"]);
if (status.status !== 0) {
  console.error("Migration status check failed — schema and migration history are not in sync.");
  process.exit(status.status ?? 1);
}
console.log("Migrations OK.");
