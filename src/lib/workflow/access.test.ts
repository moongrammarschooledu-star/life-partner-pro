import { describe, it, expect, vi, beforeEach } from "vitest";

// This exercises the REAL per-resource access helpers (proposal-access,
// verification-access, security-flag-access, followup-access,
// profile-assignment-access, case-access) rather than mocking them — the
// whole point of src/lib/workflow/access.ts is that it delegates to them, so
// a test that mocked them away would not actually prove the delegation works.

vi.mock("@/lib/privacy/break-glass", () => ({ hasActiveBreakGlass: async () => false }));

interface Row {
  [key: string]: unknown;
}
let proposals: Map<string, Row>;
let verifications: Map<string, Row>;
let securityFlags: Map<string, Row>;
let followUps: Map<string, Row>;
let profiles: Map<string, Row>;
let cases: Map<string, Row>;
let adminAssignments: Array<{ resourceType: string; resourceId: string; adminId: string; status: string; expiresAt: Date | null; assignedAt: Date }>;
let caseAccessGrants: Map<string, { level: string }>;
let taskAccessLogs: Array<Record<string, unknown>>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => proposals.get(where.id) ?? null) },
    profileVerification: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => verifications.get(where.id) ?? null) },
    securityFlag: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => securityFlags.get(where.id) ?? null) },
    followUp: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => followUps.get(where.id) ?? null) },
    profile: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => profiles.get(where.id) ?? null) },
    case: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => cases.get(where.id) ?? null) },
    adminAssignment: {
      findFirst: vi.fn(async ({ where }: { where: { resourceType: string; resourceId: string; status: { not: string }; OR?: unknown } }) => {
        const now = new Date();
        const matches = adminAssignments.filter(
          (a) =>
            a.resourceType === where.resourceType &&
            a.resourceId === where.resourceId &&
            a.status !== where.status.not &&
            (a.expiresAt === null || a.expiresAt > now)
        );
        matches.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
        return matches[0] ?? null;
      }),
    },
    caseAccessGrant: {
      findUnique: vi.fn(async ({ where }: { where: { caseId_adminId: { caseId: string; adminId: string } } }) => {
        const key = `${where.caseId_adminId.caseId}:${where.caseId_adminId.adminId}`;
        const grant = caseAccessGrants.get(key);
        return grant ? { level: grant.level } : null;
      }),
    },
    taskAccessLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { taskAccessLogs.push(data); return data; }) },
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

import { resolveTaskAccessLevel, assertTaskAccess } from "@/lib/workflow/access";
import type { AdminTask } from "@prisma/client";

function task(overrides: Partial<AdminTask>): AdminTask {
  return {
    id: "task-1",
    taskCode: "LPP-TASK-000001",
    taskType: "GENERAL_ADMIN_TASK",
    resourceType: "PROFILE",
    resourceId: "p1",
    title: null,
    description: null,
    priority: "NORMAL",
    status: "NEW",
    dueAt: null,
    startedAt: null,
    completedAt: null,
    completionNotes: null,
    outcome: null,
    notes: null,
    assignedToId: null,
    assignedDepartmentId: null,
    createdById: null,
    accessLevel: "MANAGE",
    visibility: "STANDARD",
    version: 1,
    escalationLevel: 1,
    escalationStatus: "NONE",
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as AdminTask;
}

const staffA = { id: "staff-A", role: "STAFF_MATCHMAKER" as const, permissions: ["tasks:view", "tasks:view:own"] as never };
const staffB = { id: "staff-B", role: "STAFF_MATCHMAKER" as const, permissions: ["tasks:view", "tasks:view:own"] as never };
const manager = { id: "manager-1", role: "MATCHMAKING_MANAGER" as const, permissions: ["tasks:view", "tasks:view:team"] as never };
const superAdmin = { id: "super-1", role: "SUPER_ADMIN" as const, permissions: ["tasks:view", "tasks:view:all"] as never };
const analyst = { id: "analyst-1", role: "REPORTING_ANALYST" as const, permissions: ["tasks:view", "tasks:view:all"] as never };
const noTaskPerm = { id: "noperm-1", role: "STAFF_MATCHMAKER" as const, permissions: [] as never };

beforeEach(() => {
  proposals = new Map();
  verifications = new Map();
  securityFlags = new Map();
  followUps = new Map();
  profiles = new Map([["p1", { id: "p1" }]]);
  cases = new Map();
  adminAssignments = [];
  caseAccessGrants = new Map();
  taskAccessLogs = [];
});

describe("resolveTaskAccessLevel — base permission + assignment scope (steps 2-4)", () => {
  it("denies an admin with no tasks:view permission at all", async () => {
    const t = task({ assignedToId: noTaskPerm.id });
    const result = await resolveTaskAccessLevel(noTaskPerm, t);
    expect(result).toEqual({ allowed: false, level: null, reason: "NO_TASK_PERMISSION" });
  });

  it("allows the assignee even without a broad role", async () => {
    adminAssignments.push({ resourceType: "PROFILE", resourceId: "p1", adminId: staffA.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    const t = task({ assignedToId: staffA.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(true);
  });

  it("denies a non-assignee, non-broad staff member on someone else's task — horizontal access", async () => {
    const t = task({ assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result).toEqual({ allowed: false, level: null, reason: "NOT_YOUR_TASK" });
  });

  it("denies a non-broad staff member on an UNASSIGNED task (No Assignment = No Record Access)", async () => {
    const t = task({ assignedToId: null, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(false);
  });

  it("allows a broad-access role (manager) regardless of assignment — vertical scope, not a bypass", async () => {
    const t = task({ assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(manager, t);
    expect(result.allowed).toBe(true);
  });

  it("tasks:view:all passes the scope check (steps 3/4) but does NOT bypass the independent source-record check (step 5)", async () => {
    // §68 "no access escalation through tasks" — tasks:view:all only ever
    // widens which tasks you can attempt to open; it never substitutes for
    // the source record's own authorization, which is checked independently.
    const t = task({ assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(analyst, t);
    expect(result).toEqual({ allowed: false, level: null, reason: "SOURCE_RECORD_DENIED" });
  });

  it("tasks:view:all DOES grant access for a permission-gated domain (PAYMENT) once the matching domain permission is also held", async () => {
    const financeAnalyst = { id: "fin-analyst", role: "REPORTING_ANALYST" as const, permissions: ["tasks:view", "tasks:view:all", "finance:payments:view"] as never };
    const t = task({ resourceType: "PAYMENT", resourceId: "pay1", assignedToId: staffB.id });
    const result = await resolveTaskAccessLevel(financeAnalyst, t);
    expect(result.allowed).toBe(true);
  });
});

describe("resolveTaskAccessLevel — RESTRICTED visibility (steps 2/7)", () => {
  it("blocks a non-broad, non-assignee admin from a RESTRICTED task even with tasks:view:all", async () => {
    const t = task({ visibility: "RESTRICTED", assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(analyst, t);
    expect(result).toEqual({ allowed: false, level: null, reason: "RESTRICTED_VISIBILITY" });
  });

  it("still allows the assignee of a RESTRICTED task (once independently authorized on the source record too)", async () => {
    adminAssignments.push({ resourceType: "PROFILE", resourceId: "p1", adminId: staffA.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    const t = task({ visibility: "RESTRICTED", assignedToId: staffA.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(true);
  });

  it("still allows a broad-access role on a RESTRICTED task", async () => {
    const t = task({ visibility: "RESTRICTED", assignedToId: staffA.id, resourceType: "PROFILE", resourceId: "p1" });
    const result = await resolveTaskAccessLevel(manager, t);
    expect(result.allowed).toBe(true);
  });
});

describe("resolveTaskAccessLevel — step 5, delegates to the real per-resource helpers", () => {
  it("PROPOSAL: denies when the proposal is assigned to someone else, even though the task itself is assigned to the caller", async () => {
    proposals.set("prop1", { assignedToId: staffB.id });
    const t = task({ resourceType: "PROPOSAL", resourceId: "prop1", assignedToId: staffA.id });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result).toEqual({ allowed: false, level: null, reason: "SOURCE_RECORD_DENIED" });
  });

  it("PROPOSAL: allows when the proposal is actually assigned to the caller", async () => {
    proposals.set("prop1", { assignedToId: staffA.id });
    const t = task({ resourceType: "PROPOSAL", resourceId: "prop1", assignedToId: staffA.id });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(true);
  });

  it("VERIFICATION: delegates to assertVerificationAccess", async () => {
    verifications.set("v1", { assignedToId: staffB.id });
    const t = task({ resourceType: "VERIFICATION", resourceId: "v1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(false);
  });

  it("SECURITY_FLAG: delegates to assertSecurityFlagAccess", async () => {
    securityFlags.set("f1", { assignedToId: staffA.id });
    const t = task({ resourceType: "SECURITY_FLAG", resourceId: "f1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(true);
  });

  it("FOLLOW_UP: delegates to assertFollowUpAccess, falling back to the legacy adminId column", async () => {
    followUps.set("fu1", { id: "fu1", adminId: staffA.id });
    const t = task({ resourceType: "FOLLOW_UP", resourceId: "fu1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(true);
  });

  it("PROFILE: delegates to assertProfileAssignmentAccess via AdminAssignment", async () => {
    adminAssignments.push({ resourceType: "PROFILE", resourceId: "p1", adminId: staffA.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    const t = task({ resourceType: "PROFILE", resourceId: "p1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(true);
  });

  it("PROFILE: denies when the profile is assigned (via AdminAssignment) to someone else", async () => {
    adminAssignments.push({ resourceType: "PROFILE", resourceId: "p1", adminId: staffB.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    const t = task({ resourceType: "PROFILE", resourceId: "p1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(false);
  });

  it("CASE: a graded CaseAccessGrant of VIEW caps the resolved level at VIEW", async () => {
    cases.set("c1", { id: "c1", reportedAdminId: null });
    caseAccessGrants.set(`c1:${staffA.id}`, { level: "VIEW" });
    const t = task({ resourceType: "CASE", resourceId: "c1", assignedToId: staffA.id });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result).toEqual({ allowed: true, level: "VIEW", reason: null });
  });

  it("CASE: staff-conduct gate blocks a non-privileged admin even if the task is assigned to them", async () => {
    cases.set("c1", { id: "c1", reportedAdminId: "some-admin" });
    const t = task({ resourceType: "CASE", resourceId: "c1", assignedToId: staffA.id });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(false);
  });

  it("returns SOURCE_RECORD_DENIED (not a crash) when the underlying record no longer exists", async () => {
    const t = task({ resourceType: "PROPOSAL", resourceId: "does-not-exist", assignedToId: staffA.id });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result.allowed).toBe(false);
  });
});

describe("resolveTaskAccessLevel — step 6, task accessLevel caps the source record's level", () => {
  it("caps a MANAGE-level source record down to the task's own VIEW accessLevel", async () => {
    proposals.set("prop1", { assignedToId: staffA.id });
    const t = task({ resourceType: "PROPOSAL", resourceId: "prop1", assignedToId: staffA.id, accessLevel: "VIEW" });
    const result = await resolveTaskAccessLevel(staffA, t);
    expect(result).toEqual({ allowed: true, level: "VIEW", reason: null });
  });
});

describe("PAYMENT/PRIVACY_REQUEST/AI_SAFETY_EVENT — permission-string-only gating (no per-record ACL exists for these domains)", () => {
  it("PAYMENT: denies without finance:payments:view, allows with it", async () => {
    const t = task({ resourceType: "PAYMENT", resourceId: "pay1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(false);
    const financeAdmin = { id: "fin-1", role: "FINANCE_MANAGER" as const, permissions: ["tasks:view", "tasks:view:team", "finance:payments:view"] as never };
    const t2 = task({ resourceType: "PAYMENT", resourceId: "pay1", assignedToId: financeAdmin.id });
    expect((await resolveTaskAccessLevel(financeAdmin, t2)).allowed).toBe(true);
  });

  it("AI_SAFETY_EVENT: only ai:activity:view/ai:config:manage/ai:killswitch grant access", async () => {
    const t = task({ resourceType: "AI_SAFETY_EVENT", resourceId: "evt1", assignedToId: staffA.id });
    expect((await resolveTaskAccessLevel(staffA, t)).allowed).toBe(false);
  });
});

describe("assertTaskAccess — IDOR hardening, access-level enforcement, and audit logging", () => {
  it("throws (never grants access) when the resolved level does not meet the required minimum", async () => {
    proposals.set("prop1", { assignedToId: staffA.id });
    const t = task({ resourceType: "PROPOSAL", resourceId: "prop1", assignedToId: staffA.id, accessLevel: "VIEW" });
    await expect(assertTaskAccess(staffA, t, "MANAGE")).rejects.toMatchObject({ status: 403 });
  });

  it("succeeds and returns the resolved level when access is sufficient", async () => {
    proposals.set("prop1", { assignedToId: staffA.id });
    const t = task({ resourceType: "PROPOSAL", resourceId: "prop1", assignedToId: staffA.id });
    const level = await assertTaskAccess(staffA, t, "VIEW");
    expect(level).toBe("MANAGE");
  });

  it("writes a TaskAccessLog row on every call, allow or deny", async () => {
    const t = task({ assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    await expect(assertTaskAccess(staffA, t, "VIEW")).rejects.toBeDefined();
    expect(taskAccessLogs).toHaveLength(1);
    expect(taskAccessLogs[0]).toMatchObject({ taskId: t.id, adminId: staffA.id, allowed: false });

    adminAssignments.push({ resourceType: "PROFILE", resourceId: "p1", adminId: staffA.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    const t2 = task({ assignedToId: staffA.id, resourceType: "PROFILE", resourceId: "p1" });
    await assertTaskAccess(staffA, t2, "VIEW");
    expect(taskAccessLogs).toHaveLength(2);
    expect(taskAccessLogs[1]).toMatchObject({ allowed: true });
  });

  it("IDOR: the check always uses the task row's own resourceType/resourceId — a caller cannot widen access by passing different values, since none are accepted as parameters", async () => {
    // assertTaskAccess/resolveTaskAccessLevel take the full AdminTask row, not
    // a client-suppliable {resourceType, resourceId} pair — there is no code
    // path here that reads those fields from anywhere other than the task
    // object the route fetched fresh from the database by id.
    proposals.set("real-prop", { assignedToId: staffB.id });
    const tamperedTask = task({ resourceType: "PROPOSAL", resourceId: "real-prop", assignedToId: staffA.id });
    // Even though the TASK is "assigned" to staffA, the underlying proposal
    // is not — access is still correctly denied because resourceId is read
    // from the trusted task row, not re-derived from any request input.
    expect((await resolveTaskAccessLevel(staffA, tamperedTask)).allowed).toBe(false);
  });
});

describe("self-escalation / role-manipulation have no effect at this layer", () => {
  it("a client-supplied role override on the admin object has no bearing on the actual permission arrays checked", async () => {
    // The function only ever reads admin.permissions (resolved server-side
    // from the session) — assigning a different `role` string alone, without
    // the corresponding permissions array, changes nothing material here.
    const spoofed = { id: staffA.id, role: "SUPER_ADMIN" as const, permissions: [] as never };
    const t = task({ assignedToId: staffB.id, resourceType: "PROFILE", resourceId: "p1" });
    // Even claiming to be SUPER_ADMIN, an empty permissions array still fails
    // the base tasks:view gate — role alone never substitutes for a real,
    // session-resolved permission list.
    expect((await resolveTaskAccessLevel(spoofed, t)).allowed).toBe(false);
  });
});
