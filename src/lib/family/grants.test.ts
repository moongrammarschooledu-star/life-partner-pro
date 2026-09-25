import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakePermission { familyMemberId: string; permission: string; scope: string; status: string; grantedByProfileId: string; grantedByAdminId: string | null; expiresAt: Date | null; revokedAt: Date | null; }

let rows: FakePermission[];
let auditCalls: Record<string, unknown>[];
let taskCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/admin-tasks", () => ({ createTask: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    familyPermission: {
      upsert: vi.fn(async ({ where, update, create }: { where: { familyMemberId_permission_scope: { familyMemberId: string; permission: string; scope: string } }; update: Partial<FakePermission>; create: FakePermission }) => {
        const key = where.familyMemberId_permission_scope;
        const existing = rows.find((r) => r.familyMemberId === key.familyMemberId && r.permission === key.permission && r.scope === key.scope);
        if (existing) { Object.assign(existing, update); return existing; }
        rows.push(create);
        return create;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { familyMemberId: string; permission: string; scope: string; revokedAt: null }; data: Partial<FakePermission> }) => {
        const matches = rows.filter((r) => r.familyMemberId === where.familyMemberId && r.permission === where.permission && r.scope === where.scope && !r.revokedAt);
        matches.forEach((r) => Object.assign(r, data));
        return { count: matches.length };
      }),
    },
  },
}));

const { grantFamilyPermission, revokeFamilyPermission, FamilyGrantError } = await import("./grants");

beforeEach(() => {
  rows = [];
  auditCalls = [];
  taskCalls = [];
});

describe("grantFamilyPermission", () => {
  it("activates a non-sensitive permission immediately with no admin task", async () => {
    const row = await grantFamilyPermission({ familyMemberId: "fm1", permission: "proposal.view", grantedByProfileId: "app1" });
    expect(row.status).toBe("ACTIVE");
    expect(taskCalls).toHaveLength(0);
    expect(auditCalls[0]).toMatchObject({ action: "FAMILY_PERMISSION_GRANTED" });
  });

  it("creates a sensitive permission as PENDING_APPROVAL and files a staff review task", async () => {
    const row = await grantFamilyPermission({ familyMemberId: "fm1", permission: "profile.family.view", grantedByProfileId: "app1" });
    expect(row.status).toBe("PENDING_APPROVAL");
    expect(taskCalls).toHaveLength(1);
    expect(taskCalls[0]).toMatchObject({ taskType: "FAMILY_PERMISSION_REVIEW", resourceType: "PROFILE", resourceId: "app1" });
  });

  it("rejects an unknown permission key rather than silently granting it", async () => {
    await expect(grantFamilyPermission({ familyMemberId: "fm1", permission: "admin:manage", grantedByProfileId: "app1" })).rejects.toThrow(FamilyGrantError);
    expect(rows).toHaveLength(0);
  });

  it("re-granting the same permission updates the existing row instead of duplicating it", async () => {
    await grantFamilyPermission({ familyMemberId: "fm1", permission: "proposal.view", grantedByProfileId: "app1" });
    await grantFamilyPermission({ familyMemberId: "fm1", permission: "proposal.view", grantedByProfileId: "app1" });
    expect(rows).toHaveLength(1);
  });
});

describe("revokeFamilyPermission", () => {
  it("revokes an active permission", async () => {
    await grantFamilyPermission({ familyMemberId: "fm1", permission: "proposal.view", grantedByProfileId: "app1" });
    const ok = await revokeFamilyPermission("fm1", "proposal.view", null, "app1");
    expect(ok).toBe(true);
    expect(rows[0].status).toBe("REVOKED");
  });

  it("is a no-op for a permission the member never had", async () => {
    const ok = await revokeFamilyPermission("fm1", "proposal.view", null, "app1");
    expect(ok).toBe(false);
  });
});
