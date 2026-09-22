import { describe, it, expect, vi, beforeEach } from "vitest";

const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; meta?: Record<string, unknown> }) => { audits.push(p); } }));

let rows: Array<{ id: string; adminId: string; resourceType: string; resourceId: string; status: string; expiresAt: Date | null; assignedAt: Date }>;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminAssignment: {
      findFirst: vi.fn(({ where }: { where: { resourceType: string; resourceId: string; status: { not: string }; OR?: Array<Record<string, unknown>> } }) => {
        const now = new Date();
        const matches = rows.filter((r) => {
          if (r.resourceType !== where.resourceType || r.resourceId !== where.resourceId) return false;
          if (r.status === where.status.not) return false;
          if (where.OR) {
            const notExpired = r.expiresAt === null || r.expiresAt > now;
            if (!notExpired) return false;
          }
          return true;
        });
        matches.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
        return Promise.resolve(matches[0] ?? null);
      }),
    },
  },
}));

import { getCurrentAssigneeId } from "@/lib/admin-assignment";

beforeEach(() => {
  rows = [];
  audits.length = 0;
});

// STEP 17 §20 — lazy expiry: an AdminAssignment past its expiresAt is treated
// as if it doesn't exist, the same convention as BreakGlassAccess/
// ProfileRestriction (no cron sweep needed).
describe("getCurrentAssigneeId (lazy expiry)", () => {
  it("returns the assignee when expiresAt is null (never expires)", async () => {
    rows = [{ id: "a1", adminId: "staff-1", resourceType: "PROFILE", resourceId: "p1", status: "ASSIGNED", expiresAt: null, assignedAt: new Date() }];
    expect(await getCurrentAssigneeId("PROFILE", "p1")).toBe("staff-1");
  });

  it("returns the assignee when expiresAt is in the future", async () => {
    rows = [{ id: "a1", adminId: "staff-1", resourceType: "PROFILE", resourceId: "p1", status: "ASSIGNED", expiresAt: new Date(Date.now() + 3600_000), assignedAt: new Date() }];
    expect(await getCurrentAssigneeId("PROFILE", "p1")).toBe("staff-1");
  });

  it("treats an assignment past its expiresAt as unassigned", async () => {
    rows = [{ id: "a1", adminId: "staff-1", resourceType: "PROFILE", resourceId: "p1", status: "ASSIGNED", expiresAt: new Date(Date.now() - 3600_000), assignedAt: new Date() }];
    expect(await getCurrentAssigneeId("PROFILE", "p1")).toBeNull();
  });

  it("ignores a REASSIGNED row and returns the newer active one", async () => {
    rows = [
      { id: "a1", adminId: "staff-1", resourceType: "PROFILE", resourceId: "p1", status: "REASSIGNED", expiresAt: null, assignedAt: new Date(Date.now() - 1000) },
      { id: "a2", adminId: "staff-2", resourceType: "PROFILE", resourceId: "p1", status: "ASSIGNED", expiresAt: null, assignedAt: new Date() },
    ];
    expect(await getCurrentAssigneeId("PROFILE", "p1")).toBe("staff-2");
  });

  it("returns null for a resource with no assignment row at all", async () => {
    expect(await getCurrentAssigneeId("PROFILE", "unassigned-profile")).toBeNull();
  });

  it("does not cross resource types (a FOLLOW_UP row never answers a PROFILE lookup)", async () => {
    rows = [{ id: "a1", adminId: "staff-1", resourceType: "FOLLOW_UP", resourceId: "shared-id", status: "ASSIGNED", expiresAt: null, assignedAt: new Date() }];
    expect(await getCurrentAssigneeId("PROFILE", "shared-id")).toBeNull();
  });
});
