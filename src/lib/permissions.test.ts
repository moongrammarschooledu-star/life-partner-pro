import { describe, it, expect } from "vitest";
import { hasPermission, ROLE_PERMISSIONS, ADMIN_ROLES, SENSITIVE_PERMISSIONS, hasBroadRecordAccess, type AdminRole } from "./permissions";

describe("permissions", () => {
  it("gives SUPER_ADMIN and ADMIN the new sensitive-data permissions, but not STAFF or VIEWER", () => {
    expect(hasPermission("SUPER_ADMIN", "sensitive:income:view")).toBe(true);
    expect(hasPermission("ADMIN", "sensitive:income:view")).toBe(true);
    expect(hasPermission("STAFF", "sensitive:income:view")).toBe(false);
    expect(hasPermission("VIEWER", "sensitive:income:view")).toBe(false);

    expect(hasPermission("SUPER_ADMIN", "sensitive:notes:view")).toBe(true);
    expect(hasPermission("ADMIN", "sensitive:notes:view")).toBe(true);
    expect(hasPermission("STAFF", "sensitive:notes:view")).toBe(false);
  });

  it("gives STAFF sensitive:family:view (no behavior change, family info was already unrestricted)", () => {
    expect(hasPermission("STAFF", "sensitive:family:view")).toBe(true);
  });

  it("gates the new staff:view / profile:assign / verification:assign permissions to SUPER_ADMIN and ADMIN only", () => {
    for (const permission of ["staff:view", "profile:assign", "verification:assign"] as const) {
      expect(hasPermission("SUPER_ADMIN", permission)).toBe(true);
      expect(hasPermission("ADMIN", permission)).toBe(true);
      expect(hasPermission("STAFF", permission)).toBe(false);
      expect(hasPermission("VIEWER", permission)).toBe(false);
    }
  });

  it("never grants STAFF or VIEWER admin:manage", () => {
    expect(hasPermission("STAFF", "admin:manage")).toBe(false);
    expect(hasPermission("VIEWER", "admin:manage")).toBe(false);
  });

  it("keeps SUPER_ADMIN's permission list a superset of ADMIN's", () => {
    for (const permission of ROLE_PERMISSIONS.ADMIN) {
      expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain(permission);
    }
  });
});

// ---------------------------------------------------------------------------
// STEP 17 — exact roles, access-level tiering, sensitive permissions
// ---------------------------------------------------------------------------

describe("STEP 17 — ADMIN_ROLES (the canonical, assignable-today role list)", () => {
  it("has exactly the 13 spec roles, and excludes the two legacy labels", () => {
    expect(ADMIN_ROLES).toHaveLength(13);
    expect(ADMIN_ROLES).not.toContain("ADMIN");
    expect(ADMIN_ROLES).not.toContain("STAFF");
    for (const role of [
      "SUPER_ADMIN", "OPERATIONS_ADMIN", "MATCHMAKING_MANAGER", "VERIFICATION_MANAGER", "SUPPORT_MANAGER",
      "COMMUNICATION_MANAGER", "FINANCE_MANAGER", "STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF",
      "COMMUNICATION_STAFF", "REPORTING_ANALYST", "VIEWER",
    ] as const) {
      expect(ADMIN_ROLES).toContain(role);
    }
  });

  it("every role in ADMIN_ROLES (plus the 2 legacy labels) has a non-empty ROLE_PERMISSIONS entry", () => {
    for (const role of [...ADMIN_ROLES, "ADMIN", "STAFF"] as AdminRole[]) {
      expect(ROLE_PERMISSIONS[role]?.length ?? 0, role).toBeGreaterThan(0);
    }
  });
});

describe("STEP 17 — hasBroadRecordAccess (replaces every literal role === \"STAFF\" check)", () => {
  it("is true for SUPER_ADMIN, legacy ADMIN, OPERATIONS_ADMIN and every *_MANAGER role", () => {
    for (const role of [
      "SUPER_ADMIN", "ADMIN", "OPERATIONS_ADMIN", "MATCHMAKING_MANAGER", "VERIFICATION_MANAGER",
      "SUPPORT_MANAGER", "COMMUNICATION_MANAGER", "FINANCE_MANAGER",
    ] as const) {
      expect(hasBroadRecordAccess(role), role).toBe(true);
    }
  });

  it("is false for legacy STAFF, every *_STAFF role, REPORTING_ANALYST and VIEWER (assignment-scoped)", () => {
    for (const role of [
      "STAFF", "STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF", "REPORTING_ANALYST", "VIEWER",
    ] as const) {
      expect(hasBroadRecordAccess(role), role).toBe(false);
    }
  });
});

describe("STEP 17 — sensitive permissions are never silently granted to a scoped/read-only role", () => {
  const scopedOrReadOnly: AdminRole[] = ["STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF", "REPORTING_ANALYST", "VIEWER"];

  it("no scoped/read-only role holds every sensitive permission by default", () => {
    for (const role of scopedOrReadOnly) {
      const granted = SENSITIVE_PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].includes(p));
      expect(granted, role).not.toEqual(SENSITIVE_PERMISSIONS);
    }
  });

  it("STAFF_MATCHMAKER does not get sensitive:contact:view by default (spec §11 — granted per-admin only)", () => {
    expect(hasPermission("STAFF_MATCHMAKER", "sensitive:contact:view")).toBe(false);
  });

  it("REPORTING_ANALYST and VIEWER hold no sensitive permission at all", () => {
    for (const role of ["REPORTING_ANALYST", "VIEWER"] as const) {
      for (const p of SENSITIVE_PERMISSIONS) expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
    }
  });
});

describe("STEP 17 — role tables match the spec's stated exclusions", () => {
  it("MATCHMAKING_MANAGER cannot change matching weights, manage staff or manage finance", () => {
    for (const p of ["match:configure", "admin:manage", "staff:view", "finance:payments:manage", "roles:assign"] as const) {
      expect(hasPermission("MATCHMAKING_MANAGER", p)).toBe(false);
    }
  });

  it("VERIFICATION_MANAGER cannot finalize proposals, reveal contacts outright or touch finance", () => {
    for (const p of ["proposal:finalize", "contact:reveal", "finance:payments:manage"] as const) {
      expect(hasPermission("VERIFICATION_MANAGER", p)).toBe(false);
    }
  });

  it("VERIFICATION_STAFF cannot approve/reject unless separately granted", () => {
    expect(hasPermission("VERIFICATION_STAFF", "verification:approve")).toBe(false);
    expect(hasPermission("VERIFICATION_STAFF", "verification:reject")).toBe(false);
  });

  it("SUPPORT_MANAGER has no unrestricted financial access and cannot finalize proposals", () => {
    expect(hasPermission("SUPPORT_MANAGER", "finance:payments:manage")).toBe(false);
    expect(hasPermission("SUPPORT_MANAGER", "proposal:finalize")).toBe(false);
  });

  it("COMMUNICATION_MANAGER cannot approve contact sharing, edit profiles or approve verification", () => {
    for (const p of ["contact:reveal:override", "profile:edit", "verification:approve"] as const) {
      expect(hasPermission("COMMUNICATION_MANAGER", p)).toBe(false);
    }
  });

  it("FINANCE_MANAGER cannot access matrimonial sensitive info, change matching rules or finalize proposals", () => {
    for (const p of ["sensitive:income:view", "sensitive:family:view", "sensitive:documents:view", "match:configure", "proposal:finalize", "verification:approve"] as const) {
      expect(hasPermission("FINANCE_MANAGER", p)).toBe(false);
    }
  });

  it("STAFF_MATCHMAKER, VERIFICATION_STAFF, SUPPORT_STAFF and COMMUNICATION_STAFF never hold roles:* or admin:manage", () => {
    for (const role of ["STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF"] as const) {
      for (const p of ["roles:view", "roles:create", "roles:edit", "roles:disable", "roles:assign", "roles:delete", "admin:manage"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
      }
    }
  });

  it("COMMUNICATION_STAFF cannot approve contact sharing, edit profiles or approve verification", () => {
    for (const p of ["contact:reveal:override", "profile:edit", "verification:approve", "finance:payments:manage"] as const) {
      expect(hasPermission("COMMUNICATION_STAFF", p)).toBe(false);
    }
  });

  it("REPORTING_ANALYST is read-only: no edit/create/approve/delete/finance/role-management permission", () => {
    for (const p of [
      "profile:edit", "proposal:edit", "verification:approve", "contact:reveal:override",
      "finance:payments:manage", "finance:refunds:approve", "staff:view", "roles:assign", "settings:edit",
    ] as const) {
      expect(hasPermission("REPORTING_ANALYST", p)).toBe(false);
    }
  });

  it("only SUPER_ADMIN holds roles:* (role management is Super Admin only by default, spec §39)", () => {
    for (const role of ADMIN_ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      for (const p of ["roles:view", "roles:create", "roles:edit", "roles:disable", "roles:assign", "roles:delete"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
      }
    }
  });

  it("only SUPER_ADMIN holds match:configure (spec §34)", () => {
    for (const role of ADMIN_ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(hasPermission(role, "match:configure"), role).toBe(false);
    }
  });
});
