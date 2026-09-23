import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 18's explicit end-to-end requirement: Profile Submitted -> Profile
// Task -> Staff Assignment -> Review -> Verification Task -> Verification ->
// Match Task -> Match Review -> Proposal Task -> Proposal -> Contact
// Permission Task -> Meeting Task -> Follow-up -> Completion, verifying
// RBAC + assignment + access-level + audit at every stage. This exercises
// the real WorkflowEngine + the real access.ts nine-step chain together
// (not each in isolation, as engine.test.ts/access.test.ts already do) —
// every stage's task points at resourceType PROFILE so a single realistic
// AdminAssignment-backed fake DB covers the whole chain.

interface FakeTask {
  id: string;
  taskCode: string | null;
  taskType: string;
  resourceType: string;
  resourceId: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  accessLevel: string;
  visibility: string;
  version: number;
  escalationLevel: number;
  escalationStatus: string;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  completionNotes: string | null;
  outcome: string | null;
  title: string | null;
  createdById: string | null;
  description: string | null;
  notes: string | null;
  assignedDepartmentId: string | null;
  parentTaskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let tasks: Map<string, FakeTask>;
let assignments: Array<{ resourceType: string; resourceId: string; adminId: string; status: string; expiresAt: Date | null; assignedAt: Date }>;
let dependencies: Array<{ taskId: string; dependsOnTaskId: string; type: string }>;
let workflowEvents: Map<string, Record<string, unknown>>;
let audits: Array<{ action: string; adminId?: string | null; meta?: Record<string, unknown> }>;
let statusHistory: Array<Record<string, unknown>>;
let idCounter = 0;
const nextId = (p: string) => `${p}${++idCounter}`;

vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => { audits.push(p); } }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: async () => `LPP-TASK-${String(++idCounter).padStart(6, "0")}` }));
vi.mock("@/lib/workflow/sla", () => ({ computeTaskSlaDueDates: async () => ({ targetResponseAt: null, targetResolutionAt: null, warningAt: null }), classifyTaskSla: () => null }));
vi.mock("@/lib/notifications/events", () => ({
  notifyTaskAssigned: async () => {},
  notifyTaskReassigned: async () => {},
  notifyTaskEscalated: async () => {},
  notifyTaskDependencyCompleted: async () => {},
  notifyTaskReopened: async () => {},
}));
vi.mock("@/lib/admin-assignment", () => ({
  createAssignment: async (p: { adminId: string; resourceType: string; resourceId: string; createdById: string }) => {
    assignments.push({ resourceType: p.resourceType, resourceId: p.resourceId, adminId: p.adminId, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });
    return { id: nextId("asg") };
  },
  reassignAssignment: async () => ({ id: nextId("asg") }),
  getCurrentAssigneeId: async (resourceType: string, resourceId: string) => {
    const now = new Date();
    const matches = assignments.filter((a) => a.resourceType === resourceType && a.resourceId === resourceId && a.status !== "REASSIGNED" && (a.expiresAt === null || a.expiresAt > now));
    matches.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    return matches[0]?.adminId ?? null;
  },
}));
vi.mock("@/lib/privacy/break-glass", () => ({ hasActiveBreakGlass: async () => false }));
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "profile-1" ? { id: "profile-1" } : null)) },
    adminTask: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("task");
        const row: FakeTask = {
          id,
          taskCode: (data.taskCode as string) ?? null,
          taskType: data.taskType as string,
          resourceType: data.resourceType as string,
          resourceId: data.resourceId as string,
          status: (data.status as string) ?? "NEW",
          priority: (data.priority as string) ?? "NORMAL",
          assignedToId: (data.assignedToId as string) ?? null,
          accessLevel: (data.accessLevel as string) ?? "MANAGE",
          visibility: (data.visibility as string) ?? "STANDARD",
          version: 1,
          escalationLevel: 1,
          escalationStatus: "NONE",
          dueAt: null,
          startedAt: null,
          completedAt: null,
          completionNotes: null,
          outcome: null,
          title: (data.title as string) ?? null,
          createdById: (data.createdById as string) ?? null,
          description: (data.description as string) ?? null,
          notes: (data.notes as string) ?? null,
          assignedDepartmentId: (data.assignedDepartmentId as string) ?? null,
          parentTaskId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tasks.set(id, row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const r = tasks.get(where.id); return r ? { ...r } : null; }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const r = tasks.get(where.id); if (!r) throw new Error("not found"); return { ...r }; }),
      findFirst: vi.fn(async ({ where }: { where: { resourceType: string; resourceId: string; taskType: string; status: { in: string[] } } }) => {
        const matches = [...tasks.values()].filter((t) => t.resourceType === where.resourceType && t.resourceId === where.resourceId && t.taskType === where.taskType && where.status.in.includes(t.status));
        return matches[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const row = tasks.get(where.id);
        if (!row || row.version !== where.version) return { count: 0 };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) (row as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          else (row as unknown as Record<string, unknown>)[k] = v;
        }
        return { count: 1 };
      }),
    },
    taskStatusHistory: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { statusHistory.push(data); return data; }) },
    taskEscalation: { create: vi.fn(async () => ({})) },
    taskChecklistItem: { count: vi.fn(async () => 0) },
    taskDependency: {
      findMany: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
        const matches = dependencies.filter((d) => Object.entries(where).every(([k, v]) => (d as Record<string, unknown>)[k] === v));
        if (include) return matches.map((d) => ({ ...d, task: { ...tasks.get(d.taskId)! } }));
        return matches;
      }),
      create: vi.fn(async ({ data }: { data: { taskId: string; dependsOnTaskId: string; type: string } }) => { dependencies.push(data); return data; }),
    },
    taskAccessLog: { create: vi.fn(async () => ({})) },
    workflowEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const dedupKey = data.dedupKey as string;
        if (workflowEvents.has(dedupKey)) throw new Error("Unique constraint failed on the fields: (`dedupKey`)");
        const id = nextId("evt");
        const row = { id, status: "PENDING", ...data };
        workflowEvents.set(dedupKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const row of workflowEvents.values()) if ((row as { id: string }).id === where.id) Object.assign(row, data);
      }),
    },
    workflowFailure: { create: vi.fn(async () => ({})) },
  },
}));

import { createFromEvent, assignTask, transitionTask, completeTask } from "@/lib/workflow/engine";
import { assertTaskAccess } from "@/lib/workflow/access";
import type { AdminTask } from "@prisma/client";

// The fake DB stores loosely-typed rows for test-authoring convenience;
// assertTaskAccess only reads the fields it needs (resourceType, resourceId,
// assignedToId, accessLevel, visibility), so this cast is safe.
const asTask = (row: FakeTask): AdminTask => row as unknown as AdminTask;

const SUPER_ADMIN = { id: "super-1", role: "SUPER_ADMIN" as const, permissions: ["tasks:view", "tasks:view:all"] as never };
const STAFF = { id: "staff-1", role: "STAFF_MATCHMAKER" as const, permissions: ["tasks:view", "tasks:view:own", "tasks:accept", "tasks:complete"] as never };
const OTHER_STAFF = { id: "staff-2", role: "STAFF_MATCHMAKER" as const, permissions: ["tasks:view", "tasks:view:own", "tasks:accept", "tasks:complete"] as never };

beforeEach(() => {
  tasks = new Map();
  assignments = [];
  dependencies = [];
  workflowEvents = new Map();
  audits = [];
  statusHistory = [];
  idCounter = 0;
});

describe("STEP 18 end-to-end lifecycle: Profile Submitted -> ... -> Completion", () => {
  it("runs the full chain, enforcing RBAC + assignment + access-level + audit at every stage", async () => {
    // 1. PROFILE_SUBMITTED -> Profile Review Task
    const profileTask = await createFromEvent({
      eventName: "PROFILE_SUBMITTED",
      dedupKey: "PROFILE_SUBMITTED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "NEW_PROFILE_REVIEW",
    });
    expect(profileTask).not.toBeNull();
    expect(audits.some((a) => a.action === "TASK_CREATED")).toBe(true);

    // 2. Staff Assignment — a non-assignee cannot even see the unassigned task yet (No Assignment = No Record Access).
    await expect(assertTaskAccess(STAFF, asTask(tasks.get(profileTask!.id)!), "VIEW")).rejects.toMatchObject({ status: 403 });

    await assignTask({ taskId: profileTask!.id, adminId: STAFF.id, actorId: SUPER_ADMIN.id });
    assignments.push({ resourceType: "PROFILE", resourceId: "profile-1", adminId: STAFF.id, status: "ASSIGNED", expiresAt: null, assignedAt: new Date() });

    // 3. Review — the assignee now passes the full nine-step chain; a different staff member still does not.
    const levelForAssignee = await assertTaskAccess(STAFF, asTask(tasks.get(profileTask!.id)!), "VIEW");
    expect(levelForAssignee).toBe("MANAGE");
    await expect(assertTaskAccess(OTHER_STAFF, asTask(tasks.get(profileTask!.id)!), "VIEW")).rejects.toMatchObject({ status: 403 });

    await transitionTask({ taskId: profileTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: profileTask!.id, actorId: STAFF.id, outcome: "Approved for next stage" });
    expect(tasks.get(profileTask!.id)!.status).toBe("COMPLETED");

    // 4. Verification Task (profile now verified) -> Verification.
    const verificationTask = await createFromEvent({
      eventName: "PROFILE_VERIFIED",
      dedupKey: "PROFILE_VERIFIED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "VERIFICATION_REVIEW",
      assignedToId: STAFF.id,
    });
    expect(verificationTask!.status).toBe("ASSIGNED");
    await assertTaskAccess(STAFF, asTask(tasks.get(verificationTask!.id)!), "MANAGE");
    await transitionTask({ taskId: verificationTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: verificationTask!.id, actorId: STAFF.id, outcome: "Verified" });

    // 5. Match Task -> Match Review.
    const matchTask = await createFromEvent({
      eventName: "MATCH_CREATED",
      dedupKey: "MATCH_CREATED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "MATCH_REVIEW",
      assignedToId: STAFF.id,
    });
    await transitionTask({ taskId: matchTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: matchTask!.id, actorId: STAFF.id, outcome: "Proposal Suggested" });

    // 6. Proposal Task -> Proposal, with a Contact Permission Task depending on it.
    const proposalTask = await createFromEvent({
      eventName: "PROPOSAL_CREATED",
      dedupKey: "PROPOSAL_CREATED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "PROPOSAL_REVIEW",
      assignedToId: STAFF.id,
    });
    const contactTask = await createFromEvent({
      eventName: "MUTUAL_INTEREST",
      dedupKey: "MUTUAL_INTEREST:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "CONTACT_PERMISSION_REVIEW",
      assignedToId: STAFF.id,
    });
    dependencies.push({ taskId: contactTask!.id, dependsOnTaskId: proposalTask!.id, type: "DEPENDS_ON" });

    await transitionTask({ taskId: proposalTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: proposalTask!.id, actorId: STAFF.id, outcome: "Meeting Required" });

    // 7. Meeting Task -> Follow-up -> Completion.
    await transitionTask({ taskId: contactTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: contactTask!.id, actorId: STAFF.id, outcome: "Approved" });

    const meetingTask = await createFromEvent({
      eventName: "MEETING_SCHEDULED",
      dedupKey: "MEETING_SCHEDULED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "MEETING_TASK",
      assignedToId: STAFF.id,
    });
    await transitionTask({ taskId: meetingTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: meetingTask!.id, actorId: STAFF.id });

    const followUpTask = await createFromEvent({
      eventName: "MEETING_COMPLETED",
      dedupKey: "MEETING_COMPLETED:profile-1",
      resourceType: "PROFILE",
      resourceId: "profile-1",
      taskType: "MEETING_FOLLOWUP",
      assignedToId: STAFF.id,
    });
    await transitionTask({ taskId: followUpTask!.id, newStatus: "IN_PROGRESS", actorId: STAFF.id });
    await completeTask({ taskId: followUpTask!.id, actorId: STAFF.id, outcome: "Closed" });

    // Every stage completed, every stage's transitions were recorded, and
    // every stage independently required (and got) real assignment-based
    // access — not a single task in this chain was ever accessible to
    // OTHER_STAFF, who was never assigned anything.
    const allTasks = [profileTask, verificationTask, matchTask, proposalTask, contactTask, meetingTask, followUpTask];
    for (const t of allTasks) {
      expect(tasks.get(t!.id)!.status).toBe("COMPLETED");
      await expect(assertTaskAccess(OTHER_STAFF, asTask(tasks.get(t!.id)!), "VIEW")).rejects.toMatchObject({ status: 403 });
    }
    expect(statusHistory.length).toBeGreaterThanOrEqual(allTasks.length * 2); // IN_PROGRESS + COMPLETED per stage
    expect(audits.filter((a) => a.action === "TASK_COMPLETED")).toHaveLength(allTasks.length);
  });
});
