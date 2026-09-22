import { describe, it, expect, vi, beforeEach } from "vitest";

const audits: Array<{ action: string; adminId?: string | null; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => { audits.push(p); } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminUser: { findUnique: vi.fn() },
    customRolePermission: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { canGrantRole, canGrantPermissions, isSensitivePermission, auditRoleChange, assertCanGrantRole, assertCanGrantPermissions } from "@/lib/role-management";
import { ROLE_PERMISSIONS, ADMIN_ROLES, type AdminRole } from "@/lib/permissions";
import type { SessionAdmin } from "@/lib/route-guard";

beforeEach(() => {
  audits.length = 0;
});

function admin(role: AdminRole, permissions = ROLE_PERMISSIONS[role]): SessionAdmin {
  return { id: "a1", name: "A", email: "a@x.co", role, permissions, sid: "s1" };
}

describe("canGrantRole (spec §39/§41 — privilege escalation prevention)", () => {
  it("an actor can always grant a role that is a subset of their own permissions", () => {
    expect(canGrantRole(ROLE_PERMISSIONS.SUPER_ADMIN, "MATCHMAKING_MANAGER")).toBe(true);
    expect(canGrantRole(ROLE_PERMISSIONS.SUPER_ADMIN, "SUPER_ADMIN")).toBe(true);
  });

  it("MATCHMAKING_MANAGER cannot grant SUPER_ADMIN, or any other manager role with permissions it lacks", () => {
    expect(canGrantRole(ROLE_PERMISSIONS.MATCHMAKING_MANAGER, "SUPER_ADMIN")).toBe(false);
    expect(canGrantRole(ROLE_PERMISSIONS.MATCHMAKING_MANAGER, "FINANCE_MANAGER")).toBe(false);
    expect(canGrantRole(ROLE_PERMISSIONS.MATCHMAKING_MANAGER, "VERIFICATION_MANAGER")).toBe(false);
  });

  it("a manager CAN grant a strictly narrower assignment-scoped role it is a superset of", () => {
    expect(canGrantRole(ROLE_PERMISSIONS.MATCHMAKING_MANAGER, "STAFF_MATCHMAKER")).toBe(true);
  });

  it("no non-SUPER_ADMIN role can grant SUPER_ADMIN", () => {
    for (const role of ADMIN_ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(canGrantRole(ROLE_PERMISSIONS[role], "SUPER_ADMIN"), role).toBe(false);
    }
  });

  it("an actor with no permissions can grant nothing", () => {
    expect(canGrantRole([], "VIEWER")).toBe(false);
  });
});

describe("canGrantPermissions (custom-role grant escalation guard, spec §42)", () => {
  it("rejects a custom-role permission set containing anything the actor lacks", () => {
    expect(canGrantPermissions(ROLE_PERMISSIONS.VERIFICATION_STAFF, ["verification:approve"])).toBe(false);
    expect(canGrantPermissions(ROLE_PERMISSIONS.SUPER_ADMIN, ["verification:approve", "admin:manage"])).toBe(true);
  });
});

describe("isSensitivePermission", () => {
  it("classifies the sensitive:* permissions correctly", () => {
    expect(isSensitivePermission("sensitive:contact:view")).toBe(true);
    expect(isSensitivePermission("sensitive:finance:export")).toBe(true);
    expect(isSensitivePermission("profile:view")).toBe(false);
  });
});

describe("assertCanGrantRole / assertCanGrantPermissions (SessionAdmin-level guard)", () => {
  it("SUPER_ADMIN can grant anything without a subset check", async () => {
    await expect(assertCanGrantRole(admin("SUPER_ADMIN"), "SUPER_ADMIN")).resolves.toBeUndefined();
    await expect(assertCanGrantPermissions(admin("SUPER_ADMIN"), ["admin:manage"])).resolves.toBeUndefined();
  });

  it("a non-SUPER_ADMIN actor is denied with 403 when attempting escalation", async () => {
    await expect(assertCanGrantRole(admin("MATCHMAKING_MANAGER"), "SUPER_ADMIN")).rejects.toMatchObject({ status: 403 });
    await expect(assertCanGrantPermissions(admin("VERIFICATION_STAFF"), ["verification:approve"])).rejects.toMatchObject({ status: 403 });
  });

  it("a non-SUPER_ADMIN actor CAN grant a role within its own capability", async () => {
    await expect(assertCanGrantRole(admin("MATCHMAKING_MANAGER"), "STAFF_MATCHMAKER")).resolves.toBeUndefined();
  });
});

describe("auditRoleChange (spec §52 — fine-grained role/permission/sensitive-permission events)", () => {
  it("an initial role assignment (no previous role) writes ADMIN_ROLE_ASSIGNED, not ADMIN_USER_ROLE_CHANGED", async () => {
    await auditRoleChange({ actorId: "actor1", targetAdminId: "t1", previousRole: null, newRole: "STAFF_MATCHMAKER", previousPermissions: [], newPermissions: ROLE_PERMISSIONS.STAFF_MATCHMAKER, reason: "new hire" });
    expect(audits.map((a) => a.action)).toContain("ADMIN_ROLE_ASSIGNED");
    expect(audits.map((a) => a.action)).not.toContain("ADMIN_USER_ROLE_CHANGED");
  });

  it("changing an existing role reuses ADMIN_USER_ROLE_CHANGED (not a duplicate new event)", async () => {
    await auditRoleChange({ actorId: "actor1", targetAdminId: "t1", previousRole: "STAFF_MATCHMAKER", newRole: "MATCHMAKING_MANAGER", previousPermissions: ROLE_PERMISSIONS.STAFF_MATCHMAKER, newPermissions: ROLE_PERMISSIONS.MATCHMAKING_MANAGER, reason: "promotion" });
    expect(audits.map((a) => a.action)).toContain("ADMIN_USER_ROLE_CHANGED");
    expect(audits.map((a) => a.action)).not.toContain("ADMIN_ROLE_ASSIGNED");
  });

  it("separates ordinary and sensitive permission grants/revocations into their own audit events", async () => {
    await auditRoleChange({
      actorId: "actor1",
      targetAdminId: "t1",
      previousRole: "VERIFICATION_STAFF",
      newRole: "VERIFICATION_MANAGER",
      previousPermissions: ["verification:view", "verification:review", "sensitive:documents:view"],
      newPermissions: ["verification:view", "verification:review", "verification:approve", "sensitive:contact:view"],
      reason: "promotion",
    });
    const byAction = Object.fromEntries(audits.map((a) => [a.action, a.meta]));
    expect((byAction["ADMIN_PERMISSION_GRANTED"]?.permissions as string[]).sort()).toEqual(["verification:approve"]);
    expect(byAction["ADMIN_SENSITIVE_PERMISSION_GRANTED"]?.permissions).toEqual(["sensitive:contact:view"]);
    expect(byAction["ADMIN_SENSITIVE_PERMISSION_REVOKED"]?.permissions).toEqual(["sensitive:documents:view"]);
    expect(byAction["ADMIN_PERMISSION_REVOKED"]).toBeUndefined();
  });

  it("never audits anything when nothing actually changed", async () => {
    await auditRoleChange({ actorId: "actor1", targetAdminId: "t1", previousRole: "VIEWER", newRole: "VIEWER", previousPermissions: ROLE_PERMISSIONS.VIEWER, newPermissions: ROLE_PERMISSIONS.VIEWER, reason: "no-op" });
    expect(audits).toHaveLength(0);
  });

  it("every audit event carries the actor, target and reason (never the target's password or session)", async () => {
    await auditRoleChange({ actorId: "actor1", targetAdminId: "t1", previousRole: null, newRole: "SUPPORT_STAFF", previousPermissions: [], newPermissions: ROLE_PERMISSIONS.SUPPORT_STAFF, reason: "test" });
    for (const a of audits) {
      expect(a.adminId).toBe("actor1");
      expect(a.meta?.targetAdminId).toBe("t1");
      expect(a.meta?.reason).toBe("test");
      expect(JSON.stringify(a)).not.toMatch(/password|passwordHash|sid|token/i);
    }
  });
});
