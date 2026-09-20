#!/usr/bin/env node
/**
 * Migration validation (STEP 15 §5/§24). Static checks, no database needed:
 *  - prisma/migrations exists, has a lock file, and folders are ordered names;
 *  - every migration.sql is non-empty;
 *  - a migration that contains DESTRUCTIVE statements (DROP TABLE/COLUMN/TYPE,
 *    TRUNCATE, DELETE FROM, ALTER COLUMN … TYPE) must have a sibling file
 *    `DESTRUCTIVE_APPROVED.md` explaining the backup taken and who approved it.
 *    The baseline (0_init) is exempt — it creates objects only.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "prisma/migrations";
let failed = false;
const fail = (m) => { console.error("✗ " + m); failed = true; };

if (!existsSync(root)) {
  fail("prisma/migrations does not exist — the database schema is not version-controlled.");
  process.exit(1);
}
if (!existsSync(join(root, "migration_lock.toml"))) fail("prisma/migrations/migration_lock.toml is missing.");

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA|INDEX\s+CONCURRENTLY)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE)\b/i;

const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort();
if (dirs.length === 0) fail("No migrations found.");

for (const dir of dirs) {
  const sqlPath = join(root, dir, "migration.sql");
  if (!existsSync(sqlPath)) { fail(`${dir}: migration.sql is missing.`); continue; }
  const sql = readFileSync(sqlPath, "utf8");
  if (!sql.trim()) { fail(`${dir}: migration.sql is empty.`); continue; }
  if (dir !== "0_init" && DESTRUCTIVE.test(sql) && !existsSync(join(root, dir, "DESTRUCTIVE_APPROVED.md"))) {
    fail(`${dir}: contains destructive SQL but has no DESTRUCTIVE_APPROVED.md (record the backup taken and the approver).`);
  }
}

if (failed) process.exit(1);
console.log(`✓ ${dirs.length} migration(s) validated (${dirs.join(", ")}).`);
