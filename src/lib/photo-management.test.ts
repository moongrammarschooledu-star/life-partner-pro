import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakePhoto { id: string; profileId: string; storageKey: string; mimeType: string; sizeBytes: number; isPrimary: boolean; createdAt: Date; ivBase64: string; authTagBase64: string; }

let photos: Map<string, FakePhoto>;
let idCounter = 0;
let auditCalls: Record<string, unknown>[];
let recomputeCalls: string[];
let deletedKeys: string[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/verification/status", () => ({ recomputeStoredCompleteness: vi.fn(async (profileId: string) => { recomputeCalls.push(profileId); }) }));
vi.mock("@/lib/storage", () => ({
  savePhoto: vi.fn(async (file: Buffer) => ({ storageKey: `blob-${++idCounter}`, mimeType: "image/jpeg", sizeBytes: file.byteLength, ivBase64: "iv", authTagBase64: "tag" })),
  readPhoto: vi.fn(async (storageKey: string) => Buffer.from(`decrypted:${storageKey}`)),
  deletePhoto: vi.fn(async (storageKey: string) => { deletedKeys.push(storageKey); }),
  UploadValidationError: class UploadValidationError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profilePhoto: {
      count: vi.fn(async ({ where }: { where: { profileId: string } }) => [...photos.values()].filter((p) => p.profileId === where.profileId).length),
      create: vi.fn(async ({ data }: { data: Omit<FakePhoto, "id" | "createdAt"> }) => {
        const photo: FakePhoto = { id: `p${++idCounter}`, createdAt: new Date(), ...data };
        photos.set(photo.id, photo);
        return photo;
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where: { id?: string; profileId: string }; orderBy?: { createdAt: string } }) => {
        let list = [...photos.values()].filter((p) => p.profileId === where.profileId && (!where.id || p.id === where.id));
        if (orderBy) list = list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return list[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakePhoto> }) => {
        const p = photos.get(where.id)!;
        Object.assign(p, data);
        return p;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { profileId: string }; data: Partial<FakePhoto> }) => {
        [...photos.values()].filter((p) => p.profileId === where.profileId).forEach((p) => Object.assign(p, data));
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { photos.delete(where.id); }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const { uploadApplicantPhoto, updateApplicantPhoto, deleteApplicantPhoto, setPrimaryPhoto, PhotoManagementError, MAX_PHOTOS_PER_PROFILE } = await import("./photo-management");

beforeEach(() => {
  photos = new Map();
  auditCalls = [];
  recomputeCalls = [];
  deletedKeys = [];
});

describe("uploadApplicantPhoto", () => {
  it("makes the first photo primary and later ones non-primary", async () => {
    const p1 = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    const p2 = await uploadApplicantPhoto("me", Buffer.from("b"), "image/jpeg");
    expect(p1.isPrimary).toBe(true);
    expect(p2.isPrimary).toBe(false);
    expect(recomputeCalls).toEqual(["me", "me"]);
    expect(auditCalls.map((c) => c.action)).toEqual(["PHOTO_UPLOADED", "PHOTO_UPLOADED"]);
  });

  it("enforces MAX_PHOTOS_PER_PROFILE", async () => {
    for (let i = 0; i < MAX_PHOTOS_PER_PROFILE; i++) await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    await expect(uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg")).rejects.toThrow(PhotoManagementError);
  });
});

describe("updateApplicantPhoto — IDOR", () => {
  it("rejects a photoId belonging to another profile", async () => {
    const mine = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    await expect(updateApplicantPhoto("someoneElse", mine.id, {})).rejects.toThrow(/not found/i);
  });

  it("re-processes existing bytes when no new file is given (rotate/crop in place)", async () => {
    const mine = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    const oldKey = mine.storageKey;
    const updated = await updateApplicantPhoto("me", mine.id, { rotateDegrees: 90 });
    expect(updated.storageKey).not.toBe(oldKey);
    expect(deletedKeys).toContain(oldKey);
  });
});

describe("deleteApplicantPhoto", () => {
  it("promotes the next oldest photo to primary when the primary is deleted", async () => {
    const p1 = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    const p2 = await uploadApplicantPhoto("me", Buffer.from("b"), "image/jpeg");
    await deleteApplicantPhoto("me", p1.id);
    expect(photos.get(p2.id)!.isPrimary).toBe(true);
  });

  it("allows deleting down to zero photos (registration itself treats photos as optional)", async () => {
    const p1 = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    await deleteApplicantPhoto("me", p1.id);
    expect(photos.size).toBe(0);
  });

  it("rejects deleting a photo owned by another profile (IDOR)", async () => {
    const mine = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    await expect(deleteApplicantPhoto("stranger", mine.id)).rejects.toThrow(PhotoManagementError);
    expect(photos.has(mine.id)).toBe(true);
  });
});

describe("setPrimaryPhoto", () => {
  it("flips isPrimary across the profile's photos transactionally", async () => {
    const p1 = await uploadApplicantPhoto("me", Buffer.from("a"), "image/jpeg");
    const p2 = await uploadApplicantPhoto("me", Buffer.from("b"), "image/jpeg");
    await setPrimaryPhoto("me", p2.id);
    expect(photos.get(p1.id)!.isPrimary).toBe(false);
    expect(photos.get(p2.id)!.isPrimary).toBe(true);
  });
});
