import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { deriveBackupKey, decryptBackup } from "@/lib/backup/crypto";
import { backupModels, delegateFor } from "@/lib/backup/export";
import { fetchBackupObject } from "@/lib/backup/storage";

// Restore VERIFICATION (spec §8): a backup is only "valid" once it has been
// downloaded, checksummed, decrypted, decompressed, parsed and checked against
// the current schema. This never writes to the live database — it proves the
// backup CAN be restored; performing a restore is a separate, authorized,
// out-of-app operation (scripts/restore-backup.ts).

export interface VerifyCheck {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
}

export async function verifyBackup(backupId: string, actorId: string | null): Promise<{ passed: boolean; checks: VerifyCheck[]; testId: string }> {
  const backup = await prisma.backupRun.findUniqueOrThrow({ where: { id: backupId } });
  const test = await prisma.restoreTest.create({ data: { backupId, mode: "VERIFY_ONLY", status: "RUNNING", performedById: actorId } });
  const checks: VerifyCheck[] = [];
  const add = (name: string, status: VerifyCheck["status"], detail: string) => checks.push({ name, status, detail });

  try {
    if (backup.type !== "DATABASE") throw new Error("Only database backups can be restore-verified.");
    if (backup.status !== "COMPLETED" || !backup.storageUrl || !backup.checksumSha256) throw new Error("Backup is not in a completed, downloadable state.");
    const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY?.trim();
    if (!keyMaterial) throw new Error("BACKUP_ENCRYPTION_KEY is not configured.");

    const encrypted = await fetchBackupObject(backup.storageUrl);
    add("Download", "PASS", `${encrypted.length} bytes retrieved`);

    const checksum = createHash("sha256").update(encrypted).digest("hex");
    if (checksum !== backup.checksumSha256) throw new Error("Checksum mismatch — the stored object differs from what was written.");
    add("Checksum", "PASS", "SHA-256 matches the recorded value");

    const plain = gunzipSync(decryptBackup(encrypted, deriveBackupKey(keyMaterial)));
    add("Decrypt + decompress", "PASS", "Authenticated decryption succeeded");

    const models = new Map(backupModels().map((m) => [m.name, m]));
    const counts: Record<string, number> = {};
    const idsByModel = new Map<string, Set<string>>();
    const rows: Array<{ m: string; r: Record<string, unknown> }> = [];
    let unknownModels = 0;
    let unknownFields = 0;

    for (const line of plain.toString("utf8").split("\n")) {
      if (!line) continue;
      const parsed = JSON.parse(line) as { m: string; r: Record<string, unknown> };
      const model = models.get(parsed.m);
      if (!model) {
        unknownModels++;
        continue;
      }
      counts[parsed.m] = (counts[parsed.m] ?? 0) + 1;
      const fieldNames = new Set(model.fields.filter((f) => f.kind !== "object").map((f) => f.name));
      for (const key of Object.keys(parsed.r)) if (!fieldNames.has(key)) unknownFields++;
      const idField = model.fields.find((f) => f.isId)?.name;
      if (idField) {
        if (!idsByModel.has(parsed.m)) idsByModel.set(parsed.m, new Set());
        idsByModel.get(parsed.m)!.add(String(parsed.r[idField]));
      }
      rows.push(parsed);
    }
    add("Parse", "PASS", `${rows.length} records parsed`);

    const manifestTables = ((backup.manifest as { tables?: Record<string, number> } | null)?.tables ?? {}) as Record<string, number>;
    const mismatched = Object.entries(manifestTables).filter(([name, n]) => (counts[name] ?? 0) !== n);
    if (mismatched.length) throw new Error(`Row counts differ from the manifest for: ${mismatched.map(([n]) => n).join(", ")}`);
    add("Manifest", "PASS", "Per-table row counts match the manifest");

    if (unknownModels > 0) add("Schema (tables)", "FAIL", `${unknownModels} record(s) belong to tables that no longer exist in the current schema`);
    else add("Schema (tables)", "PASS", "Every table exists in the current schema");
    add("Schema (columns)", unknownFields > 0 ? "WARN" : "PASS", unknownFields > 0 ? `${unknownFields} column value(s) no longer exist in the current schema (restore would drop them)` : "All columns exist in the current schema");

    // Foreign-key closure inside the dataset: every referenced parent id must
    // be present. A logical export is not transactionally consistent, so a
    // small number of dangling references is a WARN, not a failure.
    let dangling = 0;
    for (const { m, r } of rows) {
      const model = models.get(m)!;
      for (const f of model.fields) {
        if (f.kind !== "object" || !f.relationFromFields?.length || f.relationFromFields.length !== 1) continue;
        const fk = r[f.relationFromFields[0]];
        if (fk == null) continue;
        const parent = idsByModel.get(f.type);
        if (parent && !parent.has(String(fk))) dangling++;
      }
    }
    add("Referential integrity", dangling > 0 ? "WARN" : "PASS", dangling > 0 ? `${dangling} reference(s) point to rows missing from the snapshot` : "All foreign keys resolve inside the snapshot");

    // Informational comparison with the live database (never a pass/fail).
    let live = 0;
    for (const model of backupModels()) live += await delegateFor(model.name).count();
    add("Live comparison", "PASS", `Snapshot ${rows.length} rows vs ${live} rows now (difference is normal after writes)`);

    const passed = !checks.some((c) => c.status === "FAIL");
    await finish(test.id, backup.id, passed, checks, actorId, backup.backupCode);
    return { passed, checks, testId: test.id };
  } catch (error) {
    add("Verification", "FAIL", redactString(error instanceof Error ? error.message : String(error), 300));
    logger.error("backup_verify_failed", { backupCode: backup.backupCode });
    await finish(test.id, backup.id, false, checks, actorId, backup.backupCode);
    return { passed: false, checks, testId: test.id };
  }
}

async function finish(testId: string, backupId: string, passed: boolean, checks: VerifyCheck[], actorId: string | null, backupCode: string) {
  await prisma.restoreTest.update({ where: { id: testId }, data: { status: passed ? "PASSED" : "FAILED", completedAt: new Date(), result: checks as unknown as Prisma.InputJsonValue } });
  await prisma.backupRun.update({ where: { id: backupId }, data: { verifiedAt: new Date(), verificationStatus: passed ? "PASSED" : "FAILED" } });
  await writeAudit({ action: "BACKUP_VERIFIED", adminId: actorId, meta: { backupCode, passed } });
}
