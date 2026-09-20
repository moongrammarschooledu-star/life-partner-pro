import { describe, it, expect } from "vitest";
import { deriveBackupKey, encryptBackup, decryptBackup } from "./crypto";
import { selectBackupsToPrune, retentionClassFor, type RetentionCandidate } from "./retention";
import { serializeRecord, confirmationPhraseFor } from "./pure";

describe("backup encryption", () => {
  const key = deriveBackupKey("a-very-long-backup-key-material-0123456789");

  it("round-trips arbitrary bytes", () => {
    const data = Buffer.from("hello backup ".repeat(1000));
    expect(decryptBackup(encryptBackup(data, key), key).equals(data)).toBe(true);
  });
  it("produces different ciphertext each time (random IV) and hides plaintext", () => {
    const data = Buffer.from("SECRET-DATA");
    const a = encryptBackup(data, key);
    const b = encryptBackup(data, key);
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from("SECRET-DATA"))).toBe(false);
  });
  it("detects tampering (GCM auth tag)", () => {
    const c = encryptBackup(Buffer.from("payload"), key);
    c[c.length - 1] ^= 0xff;
    expect(() => decryptBackup(c, key)).toThrow(/decryption failed/i);
  });
  it("rejects the wrong key and non-backup input", () => {
    const c = encryptBackup(Buffer.from("payload"), key);
    expect(() => decryptBackup(c, deriveBackupKey("another-long-backup-key-material-0123456789"))).toThrow();
    expect(() => decryptBackup(Buffer.from("not a backup"), key)).toThrow(/not a life partner pro backup/i);
  });
  it("refuses weak key material", () => {
    expect(() => deriveBackupKey("short")).toThrow(/at least 32/);
  });
});

const day = (n: number, cls: RetentionCandidate["retentionClass"] = "DAILY", verified = false): RetentionCandidate => ({ id: `b${n}`, startedAt: new Date(Date.UTC(2026, 0, 30) - n * 86_400_000), retentionClass: cls, verified });

describe("backup retention (GFS)", () => {
  it("classifies dates as monthly (1st), weekly (Sunday) or daily", () => {
    expect(retentionClassFor(new Date("2026-02-01T08:00:00Z"))).toBe("MONTHLY");
    expect(retentionClassFor(new Date("2026-02-08T08:00:00Z"))).toBe("WEEKLY"); // Sunday
    expect(retentionClassFor(new Date("2026-02-10T08:00:00Z"))).toBe("DAILY");
  });
  it("keeps only the newest N per class", () => {
    const backups = [day(0), day(1), day(2), day(3), day(4)];
    expect(selectBackupsToPrune(backups, { dailyKeep: 2, weeklyKeep: 4, monthlyKeep: 6 }).sort()).toEqual(["b2", "b3", "b4"]);
  });
  it("applies classes independently", () => {
    const backups = [day(0, "DAILY"), day(1, "DAILY"), day(7, "WEEKLY"), day(14, "WEEKLY"), day(30, "MONTHLY")];
    expect(selectBackupsToPrune(backups, { dailyKeep: 1, weeklyKeep: 1, monthlyKeep: 1 }).sort()).toEqual(["b1", "b14"]);
  });
  it("never prunes the newest backup or the newest verified backup", () => {
    const backups = [day(0), day(1), day(2, "DAILY", true), day(3)];
    const pruned = selectBackupsToPrune(backups, { dailyKeep: 0, weeklyKeep: 0, monthlyKeep: 0 });
    expect(pruned).not.toContain("b0");
    expect(pruned).not.toContain("b2");
    expect(pruned).toEqual(expect.arrayContaining(["b1", "b3"]));
  });
});

describe("backup serialization", () => {
  it("keeps BigInt and bytes lossless and never drops the model tag", () => {
    const line = serializeRecord("Thing", { id: "x", big: BigInt("9007199254740993"), bytes: new Uint8Array([1, 2, 3]), when: new Date("2026-01-01T00:00:00Z") });
    const parsed = JSON.parse(line);
    expect(parsed.m).toBe("Thing");
    expect(parsed.r.big).toEqual({ $bigint: "9007199254740993" });
    expect(parsed.r.bytes).toEqual({ $bytes: Buffer.from([1, 2, 3]).toString("base64") });
    expect(parsed.r.when).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("restore confirmation", () => {
  it("requires typing the exact backup code", () => {
    expect(confirmationPhraseFor("LPP-BKP-000007")).toBe("RESTORE LPP-BKP-000007");
  });
});
