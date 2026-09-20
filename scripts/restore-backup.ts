/**
 * Life Partner Pro — restore a logical backup (STEP 15 §58/§59).
 *
 * This is the ONLY component that can write backup data into a database. The
 * web application never does (it only verifies backups and records authorised
 * restore requests). Run it by hand, from a trusted machine:
 *
 *   BACKUP_ENCRYPTION_KEY=... npx tsx scripts/restore-backup.ts \
 *     --file ./backup.lppb  --target-url "postgresql://.../scratch?schema=restore_test"
 *
 * Safety rules enforced here:
 *  - --target-url is mandatory and never defaults to DATABASE_URL.
 *  - Restoring INTO the configured DATABASE_URL (i.e. overwriting live data)
 *    additionally requires:  --truncate --i-understand "OVERWRITE-LIVE-DATABASE"
 *  - Without --truncate the target tables must already be empty (schema applied
 *    with `prisma migrate deploy`); otherwise the script refuses.
 *  - Nothing is logged except table names and counts.
 */
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";
import { hkdfSync, createDecipheriv } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const MAGIC = Buffer.from("LPPB1");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`\nRESTORE REFUSED: ${message}\n`);
  process.exit(1);
}

function normalizeDb(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace("-pooler", "")}${u.pathname}`;
  } catch {
    return url;
  }
}

async function load(file: string): Promise<Buffer> {
  if (/^https?:\/\//.test(file)) {
    const res = await fetch(file);
    if (!res.ok) fail(`could not download backup (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFileSync(file.startsWith("file://") ? new URL(file) : file);
}

function decrypt(container: Buffer, keyMaterial: string): Buffer {
  if (keyMaterial.length < 32) fail("BACKUP_ENCRYPTION_KEY must be at least 32 characters");
  if (!container.subarray(0, MAGIC.length).equals(MAGIC)) fail("not a Life Partner Pro backup container");
  const key = Buffer.from(hkdfSync("sha256", keyMaterial, "lpp-backup-salt", "lpp-backup-encryption", 32));
  const iv = container.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = container.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(container.subarray(MAGIC.length + 28)), decipher.final()]);
  } catch {
    fail("decryption failed — wrong key or the file was modified");
  }
}

type Field = (typeof Prisma.dmmf.datamodel.models)[number]["fields"][number];

function revive(field: Field, value: unknown): unknown {
  if (value === null || value === undefined) return field.type === "Json" ? Prisma.DbNull : null;
  if (field.type === "DateTime" && typeof value === "string") return new Date(value);
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (typeof v.$bigint === "string") return BigInt(v.$bigint);
    if (typeof v.$bytes === "string") return Buffer.from(v.$bytes, "base64");
  }
  return value;
}

async function main() {
  const file = arg("file");
  const targetUrl = arg("target-url");
  const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!file) fail("--file is required");
  if (!targetUrl) fail("--target-url is required (it never defaults to DATABASE_URL)");
  if (!keyMaterial) fail("BACKUP_ENCRYPTION_KEY is not set");

  const liveUrl = process.env.DATABASE_URL;
  const targetsLive = Boolean(liveUrl) && normalizeDb(targetUrl!) === normalizeDb(liveUrl!) && !/schema=/.test(targetUrl!);
  if (targetsLive) {
    if (!flag("truncate") || arg("i-understand") !== "OVERWRITE-LIVE-DATABASE") {
      fail('the target is the configured live DATABASE_URL. To overwrite live data pass: --truncate --i-understand "OVERWRITE-LIVE-DATABASE" (and only with an approved restore request)');
    }
    console.warn("\n!!! OVERWRITING THE LIVE DATABASE in 10 seconds — press Ctrl+C to abort !!!\n");
    await new Promise((r) => setTimeout(r, 10_000));
  }

  const plain = gunzipSync(decrypt(await load(file!), keyMaterial!)).toString("utf8");
  const rowsByModel = new Map<string, Array<Record<string, unknown>>>();
  for (const line of plain.split("\n")) {
    if (!line) continue;
    const { m, r } = JSON.parse(line) as { m: string; r: Record<string, unknown> };
    if (!rowsByModel.has(m)) rowsByModel.set(m, []);
    rowsByModel.get(m)!.push(r);
  }

  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  const unknown = [...rowsByModel.keys()].filter((m) => !models.has(m));
  if (unknown.length) fail(`backup contains tables that no longer exist: ${unknown.join(", ")}`);

  const db = new PrismaClient({ datasources: { db: { url: targetUrl! } } });
  const delegate = (name: string) => (db as unknown as Record<string, { createMany: (a: unknown) => Promise<{ count: number }>; create: (a: unknown) => Promise<unknown>; count: () => Promise<number>; deleteMany: () => Promise<unknown> }>)[name.charAt(0).toLowerCase() + name.slice(1)];

  // Parent-first order from single-column foreign keys (self references ignored).
  const order: string[] = [];
  const remaining = new Set(rowsByModel.keys());
  while (remaining.size) {
    const ready = [...remaining].filter((name) => models.get(name)!.fields.every((f) => f.kind !== "object" || !f.relationFromFields?.length || f.type === name || !remaining.has(f.type)));
    const next = ready.length ? ready : [...remaining]; // cycle: fall through, retry passes handle it
    for (const n of next) { order.push(n); remaining.delete(n); }
  }

  if (flag("truncate")) {
    console.warn("Truncating target tables (children first)…");
    for (const name of [...order].reverse()) await delegate(name).deleteMany();
  } else {
    for (const name of order) {
      if ((await delegate(name).count()) > 0) fail(`target table ${name} is not empty (use an empty scratch database/schema, or --truncate)`);
    }
  }

  let deferred: Array<{ model: string; row: Record<string, unknown> }> = [];
  const build = (model: string, row: Record<string, unknown>) => {
    const data: Record<string, unknown> = {};
    for (const f of models.get(model)!.fields) if (f.kind !== "object" && f.name in row) data[f.name] = revive(f, row[f.name]);
    return data;
  };

  for (const name of order) {
    const rows = rowsByModel.get(name)!;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      try {
        await delegate(name).createMany({ data: batch.map((r) => build(name, r)) });
      } catch {
        for (const row of batch) {
          try { await delegate(name).create({ data: build(name, row) }); } catch { deferred.push({ model: name, row }); }
        }
      }
    }
    console.log(`  ${name}: ${rows.length}`);
  }

  for (let pass = 1; pass <= 6 && deferred.length; pass++) {
    const before = deferred.length;
    const next: typeof deferred = [];
    for (const item of deferred) {
      try { await delegate(item.model).create({ data: build(item.model, item.row) }); } catch { next.push(item); }
    }
    deferred = next;
    console.log(`  retry pass ${pass}: ${before} -> ${deferred.length} unresolved`);
    if (deferred.length === before) break;
  }

  let mismatches = 0;
  for (const name of order) {
    const expected = rowsByModel.get(name)!.length;
    const actual = await delegate(name).count();
    if (actual !== expected) { mismatches++; console.error(`  MISMATCH ${name}: expected ${expected}, found ${actual}`); }
  }
  await db.$disconnect();

  if (deferred.length || mismatches) fail(`${deferred.length} row(s) could not be inserted and ${mismatches} table(s) differ from the backup`);
  console.log("\nRestore complete: every table matches the backup row counts.");
  console.log("Next: run 'Post-restore validation' in Admin → System Health → Backup & Recovery, then mark the restore request executed.");
}

main().catch((error) => {
  console.error("Restore failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
