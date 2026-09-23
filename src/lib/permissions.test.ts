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

describe("STEP 18 — Workflow & Task Management permission wiring", () => {
  const MANAGER_ROLES = ["MATCHMAKING_MANAGER", "VERIFICATION_MANAGER", "SUPPORT_MANAGER", "COMMUNICATION_MANAGER", "FINANCE_MANAGER"] as const;
  const STAFF_ROLES = ["STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF"] as const;

  it("every assignable role that can see tasks at all holds the base tasks:view permission", () => {
    for (const role of ADMIN_ROLES) {
      const canSeeAnyTaskScope = ["tasks:view:own", "tasks:view:team", "tasks:view:all"].some((p) => hasPermission(role, p as never));
      if (canSeeAnyTaskScope) expect(hasPermission(role, "tasks:view"), role).toBe(true);
    }
  });

  it("SUPER_ADMIN and OPERATIONS_ADMIN hold every task permission, including workflow-failures and automation config", () => {
    for (const role of ["SUPER_ADMIN", "OPERATIONS_ADMIN"] as const) {
      for (const p of ["tasks:view:all", "tasks:assign:any", "tasks:templates:manage", "tasks:sla:manage", "tasks:automation:manage", "tasks:workflow-failures:resolve", "staff:availability:manage"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(true);
      }
    }
  });

  it("every *_MANAGER role can view its team queue, assign, reassign and escalate, but not workflow-failures or automation config", () => {
    for (const role of MANAGER_ROLES) {
      for (const p of ["tasks:view:team", "tasks:assign", "tasks:reassign", "tasks:escalate", "tasks:bulk-actions"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(true);
      }
      for (const p of ["tasks:view:all", "tasks:automation:manage", "tasks:sla:manage", "tasks:workflow-failures:view"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
      }
      // tasks:escalate:senior is SUPPORT_MANAGER-only — covered by the dedicated test below.
      if (role !== "SUPPORT_MANAGER") expect(hasPermission(role, "tasks:escalate:senior"), role).toBe(false);
    }
  });

  it("SUPPORT_MANAGER alone among managers holds tasks:escalate:senior (mirrors its cases:escalate:senior grant)", () => {
    expect(hasPermission("SUPPORT_MANAGER", "tasks:escalate:senior")).toBe(true);
    for (const role of MANAGER_ROLES.filter((r) => r !== "SUPPORT_MANAGER")) {
      expect(hasPermission(role, "tasks:escalate:senior"), role).toBe(false);
    }
  });

  it("every *_STAFF role sees only its own tasks — no create/assign/reassign/escalate/bulk-actions", () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission(role, "tasks:view:own"), role).toBe(true);
      expect(hasPermission(role, "tasks:accept"), role).toBe(true);
      expect(hasPermission(role, "tasks:complete"), role).toBe(true);
      for (const p of ["tasks:view:team", "tasks:view:all", "tasks:create", "tasks:assign", "tasks:reassign", "tasks:escalate", "tasks:bulk-actions"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
      }
    }
  });

  it("REPORTING_ANALYST gets read-only, org-wide task visibility with zero mutation permissions", () => {
    expect(hasPermission("REPORTING_ANALYST", "tasks:view:all")).toBe(true);
    expect(hasPermission("REPORTING_ANALYST", "tasks:reports:view")).toBe(true);
    for (const p of ["tasks:create", "tasks:assign", "tasks:complete", "tasks:escalate", "tasks:reopen", "tasks:cancel", "tasks:bulk-actions"] as const) {
      expect(hasPermission("REPORTING_ANALYST", p)).toBe(false);
    }
  });

  it("VIEWER is scoped to its own tasks, read-only", () => {
    expect(hasPermission("VIEWER", "tasks:view:own")).toBe(true);
    for (const p of ["tasks:view:all", "tasks:create", "tasks:complete", "tasks:escalate"] as const) {
      expect(hasPermission("VIEWER", p)).toBe(false);
    }
  });

  it("tasks:workflow-failures:*/tasks:automation:manage/tasks:sla:manage/staff:availability:manage are SUPER_ADMIN/OPERATIONS_ADMIN only", () => {
    const systemOnly = ["tasks:workflow-failures:view", "tasks:workflow-failures:resolve", "tasks:automation:manage", "tasks:sla:manage", "staff:availability:manage"] as const;
    for (const role of ADMIN_ROLES.filter((r) => r !== "SUPER_ADMIN" && r !== "OPERATIONS_ADMIN")) {
      for (const p of systemOnly) expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
    }
  });
});

// ---------- Approval Governance (STEP 19) ----------
describe("permissions — Approval Governance (STEP 19)", () => {
  const MANAGER_ROLES = ["MATCHMAKING_MANAGER", "VERIFICATION_MANAGER", "SUPPORT_MANAGER", "COMMUNICATION_MANAGER", "FINANCE_MANAGER"] as const;
  const STAFF_ROLES = ["STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF"] as const;

  it("only SUPER_ADMIN holds approvals:policy:manage and approvals:emergency-override (spec §9/§25)", () => {
    expect(hasPermission("SUPER_ADMIN", "approvals:policy:manage")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "approvals:emergency-override")).toBe(true);
    for (const role of ADMIN_ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(hasPermission(role, "approvals:policy:manage"), role).toBe(false);
      expect(hasPermission(role, "approvals:emergency-override"), role).toBe(false);
    }
  });

  it("OPERATIONS_ADMIN gets the full governance permission set except policy:manage and emergency-override", () => {
    expect(hasPermission("OPERATIONS_ADMIN", "approvals:approve")).toBe(true);
    expect(hasPermission("OPERATIONS_ADMIN", "approvals:execute")).toBe(true);
    expect(hasPermission("OPERATIONS_ADMIN", "ai:approval:approve")).toBe(true);
    expect(hasPermission("OPERATIONS_ADMIN", "approvals:policy:manage")).toBe(false);
    expect(hasPermission("OPERATIONS_ADMIN", "approvals:emergency-override")).toBe(false);
  });

  it("every *_MANAGER role can create/approve/reject/escalate but never execute or manage policy (spec §39)", () => {
    for (const role of MANAGER_ROLES) {
      expect(hasPermission(role, "approvals:view"), role).toBe(true);
      expect(hasPermission(role, "approvals:create"), role).toBe(true);
      expect(hasPermission(role, "approvals:approve"), role).toBe(true);
      expect(hasPermission(role, "approvals:reject"), role).toBe(true);
      expect(hasPermission(role, "approvals:execute"), role).toBe(false);
      expect(hasPermission(role, "approvals:policy:manage"), role).toBe(false);
      expect(hasPermission(role, "approvals:emergency-override"), role).toBe(false);
    }
  });

  it("FINANCE_MANAGER alone among managers holds finance:approval:execute", () => {
    expect(hasPermission("FINANCE_MANAGER", "finance:approval:execute")).toBe(true);
    for (const role of MANAGER_ROLES.filter((r) => r !== "FINANCE_MANAGER")) {
      expect(hasPermission(role, "finance:approval:execute"), role).toBe(false);
    }
  });

  it("SUPPORT_MANAGER alone among managers holds security:approval:view/approve (mirrors its safety_cases ownership)", () => {
    expect(hasPermission("SUPPORT_MANAGER", "security:approval:approve")).toBe(true);
    for (const role of MANAGER_ROLES.filter((r) => r !== "SUPPORT_MANAGER")) {
      expect(hasPermission(role, "security:approval:approve"), role).toBe(false);
    }
  });

  it("every *_STAFF role can create/submit a request (the maker) but can NEVER approve/reject/execute one (spec §5/§39)", () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission(role, "approvals:view"), role).toBe(true);
      expect(hasPermission(role, "approvals:create"), role).toBe(true);
      expect(hasPermission(role, "approvals:submit"), role).toBe(true);
      for (const p of ["approvals:approve", "approvals:reject", "approvals:request-changes", "approvals:execute", "approvals:escalate", "approvals:policy:manage"] as const) {
        expect(hasPermission(role, p), `${role} / ${p}`).toBe(false);
      }
    }
  });

  it("REPORTING_ANALYST is read-only governance visibility with zero decision permissions", () => {
    expect(hasPermission("REPORTING_ANALYST", "approvals:view")).toBe(true);
    expect(hasPermission("REPORTING_ANALYST", "approvals:audit:view")).toBe(true);
    for (const p of ["approvals:create", "approvals:approve", "approvals:reject", "approvals:execute"] as const) {
      expect(hasPermission("REPORTING_ANALYST", p)).toBe(false);
    }
  });

  it("VIEWER can only view approvals, nothing else", () => {
    expect(hasPermission("VIEWER", "approvals:view")).toBe(true);
    for (const p of ["approvals:create", "approvals:approve", "approvals:execute"] as const) {
      expect(hasPermission("VIEWER", p)).toBe(false);
    }
  });

  it("legacy ADMIN/STAFF roles are untouched by STEP 19 (no approvals:* granted, matching the STEP 18 precedent)", () => {
    for (const p of ["approvals:view", "approvals:create", "approvals:approve"] as const) {
      expect(hasPermission("ADMIN", p)).toBe(false);
      expect(hasPermission("STAFF", p)).toBe(false);
    }
  });

  it("sensitive:approval:view/approve are included in SENSITIVE_PERMISSIONS", () => {
    expect(SENSITIVE_PERMISSIONS).toContain("sensitive:approval:view");
    expect(SENSITIVE_PERMISSIONS).toContain("sensitive:approval:approve");
  });
});
