import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Backup encryption (spec §6). AES-256-GCM with a DEDICATED key
// (BACKUP_ENCRYPTION_KEY) — deliberately NOT derived from NEXTAUTH_SECRET, so
// rotating the session/file secret can never make backups unreadable.
// Container layout: "LPPB1" magic | 12-byte IV | 16-byte auth tag | ciphertext.

const MAGIC = Buffer.from("LPPB1");

export function deriveBackupKey(keyMaterial: string): Buffer {
  if (!keyMaterial || keyMaterial.length < 32) throw new Error("BACKUP_ENCRYPTION_KEY must be at least 32 characters.");
  return Buffer.from(hkdfSync("sha256", keyMaterial, "lpp-backup-salt", "lpp-backup-encryption", 32));
}

export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(container: Buffer, key: Buffer): Buffer {
  if (container.length < MAGIC.length + 28 || !container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Not a Life Partner Pro backup container.");
  }
  const iv = container.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = container.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = container.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Backup decryption failed (wrong key or the file was modified).");
  }
}
