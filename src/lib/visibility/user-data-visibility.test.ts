import { describe, it, expect, vi } from "vitest";

let auditRows: { action: string; createdAt: Date }[];
let accessRows: { action: string; dataCategory: string; createdAt: Date }[];
let profileRow: Record<string, unknown> | null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: vi.fn(async () => auditRows) },
    privacyAccessLog: { findMany: vi.fn(async () => accessRows) },
    profile: { findUnique: vi.fn(async () => profileRow) },
  },
}));

const { getActivityTimeline, buildSelfProfileView, projectSelfStatus } = await import("./user-data-visibility");

describe("getActivityTimeline", () => {
  it("merges and sorts audit + access events by recency, newest first", async () => {
    auditRows = [{ action: "PHOTO_UPLOADED", createdAt: new Date("2026-01-02") }];
    accessRows = [{ action: "CONTACT_VIEWED", dataCategory: "contact", createdAt: new Date("2026-01-03") }];
    const { items, total } = await getActivityTimeline("p1");
    expect(total).toBe(2);
    expect(items[0].action).toBe("CONTACT_VIEWED");
    expect(items[1].action).toBe("PHOTO_UPLOADED");
  });

  it("paginates", async () => {
    auditRows = Array.from({ length: 5 }, (_, i) => ({ action: "PHOTO_UPLOADED", createdAt: new Date(2026, 0, i + 1) }));
    accessRows = [];
    const page1 = await getActivityTimeline("p1", { page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page3 = await getActivityTimeline("p1", { page: 3, pageSize: 2 });
    expect(page3.items).toHaveLength(1);
  });

  it("filters by category substring", async () => {
    auditRows = [{ action: "PHOTO_UPLOADED", createdAt: new Date() }, { action: "MEETING_CONFIRMED_BY_APPLICANT", createdAt: new Date() }];
    accessRows = [];
    const { items } = await getActivityTimeline("p1", { category: "meeting" });
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe("MEETING_CONFIRMED_BY_APPLICANT");
  });
});

describe("buildSelfProfileView", () => {
  it("returns null for a nonexistent profile", async () => {
    profileRow = null;
    expect(await buildSelfProfileView("nope")).toBeNull();
  });

  it("includes every own-data section with no redaction (self-view, not another profile's data)", async () => {
    profileRow = {
      profileCode: "LPP-000001",
      status: "ACTIVE",
      verified: true,
      accountStatus: "ACTIVE",
      profileCompletion: 80,
      createdAt: new Date(),
      fullName: "Me",
      gender: "FEMALE",
      dateOfBirth: new Date("1998-01-01"),
      maritalStatus: "NEVER_MARRIED",
      heightCm: 165,
      city: "Lahore",
      area: null,
      country: "Pakistan",
      nationality: null,
      hasChildren: null,
      numberOfChildren: null,
      contact: { mobileNumber: "0300", email: "a@b.com" },
      education: { level: "Masters" },
      profession: { profession: "Engineer" },
      family: { familyType: "NUCLEAR" },
      lifestyle: { religion: "Islam" },
      preference: { minAge: 25 },
      photos: [],
      pendingUpdate: null,
    };
    const view = await buildSelfProfileView("p1");
    expect(view?.contact).toEqual({ mobileNumber: "0300", email: "a@b.com" });
    expect(view?.hasPendingUpdate).toBe(false);
  });
});

describe("projectSelfStatus", () => {
  it("returns exactly the frozen field set", () => {
    const view = projectSelfStatus({ profileCode: "LPP-1", status: "ACTIVE" as never, verified: true, profileCompletion: 50, createdAt: new Date() });
    expect(Object.keys(view).sort()).toEqual(["createdAt", "profileCode", "profileCompletion", "status", "verified"].sort());
  });
});
