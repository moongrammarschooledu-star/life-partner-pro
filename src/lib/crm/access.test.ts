import { describe, it, expect, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

// access.ts imports the real route-guard.ts for ApiError, which in turn pulls
// in auth.ts's NextAuth chain — unnecessary for this dependency-free
// pure-function test, and mirrors role-management.test.ts's own mock.
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends HttpError {},
}));

import { canSeeCrmRecord, assertCanSeeCrmRecord, visibleNoteTiers, type CrmAccessAdmin } from "./access";

function admin(overrides: Partial<CrmAccessAdmin> = {}): CrmAccessAdmin {
  return { id: "admin-1", role: "STAFF_MATCHMAKER", permissions: ["crm:view"], ...overrides };
}

describe("canSeeCrmRecord (spec §69 — no assignment = no record access)", () => {
  it("denies a caller without crm:view entirely, even if assigned", () => {
    expect(canSeeCrmRecord(admin({ permissions: [], id: "staff-1" }), { assignedStaffId: "staff-1" })).toBe(false);
  });

  it("denies a scoped role that is not the assigned staff member", () => {
    expect(canSeeCrmRecord(admin({ id: "staff-1" }), { assignedStaffId: "staff-2" })).toBe(false);
  });

  it("allows the assigned staff member", () => {
    expect(canSeeCrmRecord(admin({ id: "staff-1" }), { assignedStaffId: "staff-1" })).toBe(true);
  });

  it("allows any broad-access role regardless of assignment", () => {
    expect(canSeeCrmRecord(admin({ role: "OPERATIONS_ADMIN", id: "op-1" }), { assignedStaffId: "someone-else" })).toBe(true);
  });

  it("denies an unassigned record to a scoped role", () => {
    expect(canSeeCrmRecord(admin({ id: "staff-1" }), { assignedStaffId: null })).toBe(false);
  });
});

describe("assertCanSeeCrmRecord", () => {
  it("throws a 403 error when access is denied", () => {
    expect(() => assertCanSeeCrmRecord(admin({ id: "staff-1" }), { assignedStaffId: "someone-else" })).toThrow(HttpError);
  });

  it("does not throw when access is allowed", () => {
    expect(() => assertCanSeeCrmRecord(admin({ id: "staff-1" }), { assignedStaffId: "staff-1" })).not.toThrow();
  });
});

describe("visibleNoteTiers (spec §24/§70 — manager-only note tier)", () => {
  it("excludes MANAGER_ONLY for an ordinary staff caller", () => {
    const tiers = visibleNoteTiers(admin());
    expect(tiers).toEqual(["PUBLIC_TO_USER", "INTERNAL_ONLY", "STAFF_SHARED"]);
  });

  it("includes MANAGER_ONLY when crm:notes:manager_view is held", () => {
    const tiers = visibleNoteTiers(admin({ permissions: ["crm:view", "crm:notes:manager_view"] }));
    expect(tiers).toContain("MANAGER_ONLY");
  });

  it("includes MANAGER_ONLY when sensitive:crm:notes:view is held", () => {
    const tiers = visibleNoteTiers(admin({ permissions: ["crm:view", "sensitive:crm:notes:view"] }));
    expect(tiers).toContain("MANAGER_ONLY");
  });
});
