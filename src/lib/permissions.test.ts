import { describe, it, expect } from "vitest";
import { hasPermission, ROLE_PERMISSIONS } from "./permissions";

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
