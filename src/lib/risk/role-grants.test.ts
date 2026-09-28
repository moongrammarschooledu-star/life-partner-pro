import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS, hasPermission, type AdminRole, type Permission } from "@/lib/permissions";
import { readFileSync } from "fs";
import { join } from "path";

// STEP 24 - who may do what with risk data. The adverse / configuration / sensitive permissions must stay with
// the few senior roles that own them; ordinary staff roles must hold none of them.

const ADVERSE_OR_CONFIG: Permission[] = [
  "risk:restrict", "risk:suspend", "risk:rules:manage", "risk:configuration:manage", "security:incidents:manage",
  "duplicates:merge", "risk:evidence:manage", "sensitive:security:view", "sensitive:device:view", "sensitive:network:view", "sensitive:evidence:view",
];

const holders = (permission: Permission) => (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => hasPermission(r, permission));

describe("role grants for STEP 24 permissions", () => {
  it("SUPER_ADMIN holds every risk / security permission", () => {
    for (const p of ADVERSE_OR_CONFIG) expect(hasPermission("SUPER_ADMIN", p), p).toBe(true);
  });

  it("ordinary staff roles hold NONE of the adverse, configuration or sensitive risk permissions", () => {
    for (const role of ["STAFF", "VIEWER", "STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF", "COMMUNICATION_MANAGER", "REPORTING_ANALYST", "FINANCE_MANAGER"] as AdminRole[]) {
      for (const p of ADVERSE_OR_CONFIG) expect(hasPermission(role, p), `${role} must not hold ${p}`).toBe(false);
    }
  });

  it("account-suspension and rule-change power are not held by the same non-super role", () => {
    const suspenders = holders("risk:suspend").filter((r) => r !== "SUPER_ADMIN");
    const ruleChangers = holders("risk:rules:manage").filter((r) => r !== "SUPER_ADMIN");
    for (const role of suspenders) expect(ruleChangers, `${role} can both suspend accounts and edit the rules`).not.toContain(role);
  });

  it("only compliance-type roles (plus super admin) can manage rules and thresholds", () => {
    for (const p of ["risk:rules:manage", "risk:configuration:manage"] as Permission[]) {
      for (const role of holders(p)) expect(["SUPER_ADMIN", "COMPLIANCE_MANAGER"], `${role} holds ${p}`).toContain(role);
    }
  });

  it("the reporting analyst never gets case detail, evidence or the security event ledger", () => {
    expect(hasPermission("REPORTING_ANALYST", "risk:evidence:view")).toBe(false);
    expect(hasPermission("REPORTING_ANALYST", "security:events:view")).toBe(false);
    expect(hasPermission("REPORTING_ANALYST", "risk:view")).toBe(false);
  });

  it("the risk AI summary is limited to the roles that can review cases", () => {
    for (const role of holders("ai:risk:use")) expect(["SUPER_ADMIN", "VERIFICATION_MANAGER", "SUPPORT_MANAGER", "COMPLIANCE_MANAGER"], role).toContain(role);
  });

  it("every new permission is documented in the permission catalogue", () => {
    const defs = readFileSync(join(process.cwd(), "src/lib/permission-defs.ts"), "utf8");
    for (const p of [...ADVERSE_OR_CONFIG, "risk:view", "risk:investigate", "risk:clear", "risk:escalate", "risk:reports:view", "risk:reports:export", "security:events:view", "user-reports:view", "user-reports:manage", "ai:risk:use"] as Permission[]) {
      expect(defs.includes(`"${p}":`), `${p} has a description`).toBe(true);
    }
  });
});
