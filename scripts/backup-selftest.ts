/**
 * Developer tool: exercise the backup → verify → restore pipeline WITHOUT
 * touching production records (STEP 15 §8 "backup is not valid until restore
 * verification passes").
 *
 *   # 1. Read-only export of any database into an encrypted file
 *   BACKUP_ENCRYPTION_KEY=... npx tsx scripts/backup-selftest.ts export "<source url>" ./test.lppb
 *
 *   # 2. Restore that file into an EMPTY scratch database/schema
 *   BACKUP_ENCRYPTION_KEY=... npx tsx scripts/restore-backup.ts --file ./test.lppb --target-url "<scratch url>"
 *
 *   # 3. Run the real application backup + verify flow against that scratch DB
 *   DATABASE_URL="<scratch url>" BACKUP_ENCRYPTION_KEY=... BACKUP_LOCAL_DIR=./.backups-selftest \
 *     npx tsx scripts/backup-selftest.ts flow
 *
 * It refuses to run in a production environment and never prints row data.
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

if (process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production") {
  console.error("Refusing to run in a production environment.");
  process.exit(1);
}

async function main() {
  const mode = process.argv[2];
  const key = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("BACKUP_ENCRYPTION_KEY is required");

  if (mode === "export") {
    const [, , , sourceUrl, outFile] = process.argv;
    if (!sourceUrl || !outFile) throw new Error("usage: export <source url> <out file>");
    const { buildBackupPayload } = await import("../src/lib/backup/export");
    const client = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
    const started = Date.now();
    const result = await buildBackupPayload(client, key);
    writeFileSync(outFile, result.encrypted);
    await client.$disconnect();
    console.log(`Exported ${result.totalRows} rows across ${Object.keys((result.manifest as { tables: object }).tables).length} tables in ${Date.now() - started} ms`);
    console.log(`Encrypted container: ${result.encrypted.length} bytes, sha256 ${result.checksum.slice(0, 16)}…`);
    return;
  }

  if (mode === "flow") {
    if (!process.env.BACKUP_LOCAL_DIR) throw new Error("BACKUP_LOCAL_DIR is required for the local flow");
    const { createDatabaseBackup } = await import("../src/lib/backup/export");
    const { verifyBackup } = await import("../src/lib/backup/verify");
    const outcome = await createDatabaseBackup({ trigger: "MANUAL", actorId: null });
    console.log("backup:", outcome.status, outcome.backupCode ?? "", outcome.message ?? "");
    if (outcome.status !== "COMPLETED" || !outcome.backupId) process.exit(1);
    const verification = await verifyBackup(outcome.backupId, null);
    for (const c of verification.checks) console.log(`  [${c.status}] ${c.name} — ${c.detail}`);
    console.log("restore verification:", verification.passed ? "PASSED" : "FAILED");
    process.exit(verification.passed ? 0 : 1);
  }

  throw new Error("mode must be 'export' or 'flow'");
}

main().catch((error) => {
  console.error("selftest failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
