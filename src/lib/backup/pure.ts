// Pure backup helpers (no Prisma / storage imports) so they are unit-testable.

export const BACKUP_FORMAT = "lpp-ndjson-gzip-aes256gcm-v1";

// One NDJSON line per row. BigInt and bytes are tagged so the restore script
// can rebuild exact values; Dates serialise to ISO strings via toJSON.
export function serializeRecord(model: string, row: unknown): string {
  return JSON.stringify({ m: model, r: row }, (_key, value) => {
    if (typeof value === "bigint") return { $bigint: value.toString() };
    if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
    return value;
  });
}

// The exact phrase an admin must type to request a restore (spec §58).
export function confirmationPhraseFor(backupCode: string): string {
  return `RESTORE ${backupCode}`;
}
