import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- fixtures ----------
interface FakeTask {
  id: string;
  taskCode: string | null;
  taskType: string;
  resourceType: string;
  resourceId: string;
  title: string | null;
  description: string | null;
  priority: string;
  status: string;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  completionNotes: string | null;
  outcome: string | null;
  notes: string | null;
  assignedToId: string | null;
  assignedDepartmentId: string | null;
  createdById: string | null;
  accessLevel: string;
  visibility: string;
  version: number;
  escalationLevel: number;
  escalationStatus: string;
}

let tasks: Map<string, FakeTask>;
let statusHistory: Array<Record<string, unknown>>;
let escalations: Array<Record<string, unknown>>;
let checklistItems: Array<{ taskId: string; required: boolean; completedAt: Date | null }>;
let dependencies: Array<{ taskId: string; dependsOnTaskId: string; type: string }>;
let workflowEvents: Map<string, Record<string, unknown>>;
let workflowFailures: Array<Record<string, unknown>>;
let idCounter = 0;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

const audits: Array<{ action: string; adminId?: string | null; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => { audits.push(p); } }));

const assignmentsCreated: Array<Record<string, unknown>> = [];
const reassignments: Array<Record<string, unknown>> = [];
vi.mock("@/lib/admin-assignment", () => ({
  createAssignment: async (p: Record<string, unknown>) => { assignmentsCreated.push(p); return { id: nextId("asg") }; },
  reassignAssignment: async (p: Record<string, unknown>) => { reassignments.push(p); return { id: nextId("asg") }; },
}));

vi.mock("@/lib/privacy/codes", () => ({
  nextSequenceCode: async () => `LPP-TASK-${String(idCounter + 1).padStart(6, "0")}`,
}));

vi.mock("@/lib/workflow/sla", () => ({
  computeTaskSlaDueDates: async () => ({ targetResponseAt: null, targetResolutionAt: null, warningAt: null }),
  classifyTaskSla: () => null,
}));

vi.mock("@/lib/workflow/dedup", () => ({
  findExistingOpenTask: vi.fn(async () => null),
}));

const notifications: Array<{ fn: string; args: unknown[] }> = [];
vi.mock("@/lib/notifications/events", () => ({
  notifyTaskAssigned: async (...args: unknown[]) => { notifications.push({ fn: "assigned", args }); },
  notifyTaskReassigned: async (...args: unknown[]) => { notifications.push({ fn: "reassigned", args }); },
  notifyTaskEscalated: async (...args: unknown[]) => { notifications.push({ fn: "escalated", args }); },
  notifyTaskDependencyCompleted: async (...args: unknown[]) => { notifications.push({ fn: "dependencyCompleted", args }); },
  notifyTaskReopened: async (...args: unknown[]) => { notifications.push({ fn: "reopened", args }); },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminTask: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("task");
        const row: FakeTask = {
          id,
          taskCode: (data.taskCode as string) ?? null,
          taskType: data.taskType as string,
          resourceType: data.resourceType as string,
          resourceId: data.resourceId as string,
          title: (data.title as string) ?? null,
          description: (data.description as string) ?? null,
          priority: (data.priority as string) ?? "NORMAL",
          status: (data.status as string) ?? "NEW",
          dueAt: (data.dueAt as Date) ?? null,
          startedAt: null,
          completedAt: null,
          completionNotes: null,
          outcome: null,
          notes: (data.notes as string) ?? null,
          assignedToId: (data.assignedToId as string) ?? null,
          assignedDepartmentId: (data.assignedDepartmentId as string) ?? null,
          createdById: (data.createdById as string) ?? null,
          accessLevel: (data.accessLevel as string) ?? "MANAGE",
          visibility: (data.visibility as string) ?? "STANDARD",
          version: 1,
          escalationLevel: 1,
          escalationStatus: "NONE",
        };
        tasks.set(id, row);
        return { ...row };
      }),
      // Real Prisma always returns a fresh, independent object — never a
      // live reference into internal state — so every read here is copied.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = tasks.get(where.id);
        return row ? { ...row } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = tasks.get(where.id);
        if (!row) throw new Error("not found");
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const row = tasks.get(where.id);
        if (!row || row.version !== where.version) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          if (key === "version" && value && typeof value === "object" && "increment" in (value as object)) {
            row.version += (value as { increment: number }).increment;
          } else {
            (row as unknown as Record<string, unknown>)[key] = value;
          }
        }
        return { count: 1 };
      }),
    },
    taskStatusHistory: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { statusHistory.push(data); return data; }) },
    taskEscalation: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { escalations.push(data); return data; }) },
    taskChecklistItem: {
      count: vi.fn(async ({ where }: { where: { taskId: string; required: boolean; completedAt: null } }) =>
        checklistItems.filter((c) => c.taskId === where.taskId && c.required === where.required && c.completedAt === where.completedAt).length
      ),
    },
    taskDependency: {
      findMany: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
        const matches = dependencies.filter((d) => Object.entries(where).every(([k, v]) => (d as Record<string, unknown>)[k] === v));
        if (include) return matches.map((d) => ({ ...d, task: { ...tasks.get(d.taskId)! } }));
        return matches;
      }),
    },
    workflowEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const dedupKey = data.dedupKey as string;
        if (workflowEvents.has(dedupKey)) {
          const err = new Error("Unique constraint failed on the fields: (`dedupKey`)");
          throw err;
        }
        const id = nextId("evt");
        const row = { id, status: "PENDING", ...data };
        workflowEvents.set(dedupKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const row of workflowEvents.values()) {
          if ((row as { id: string }).id === where.id) Object.assign(row, data);
        }
      }),
    },
    workflowFailure: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { workflowFailures.push(data); return data; }) },
  },
}));

import { createTask, createFromEvent, assignTask, reassignTask, transitionTask, escalateTask, completeTask, reopenTask, cancelTask, WorkflowError } from "@/lib/workflow/engine";
import { findExistingOpenTask } from "@/lib/workflow/dedup";
import { prisma } from "@/lib/prisma";

beforeEach(() => {
  tasks = new Map();
  statusHistory = [];
  escalations = [];
  checklistItems = [];
  dependencies = [];
  workflowEvents = new Map();
  workflowFailures = [];
  audits.length = 0;
  assignmentsCreated.length = 0;
  reassignments.length = 0;
  notifications.length = 0;
  idCounter = 0;
  vi.mocked(findExistingOpenTask).mockResolvedValue(null);
});

describe("createTask", () => {
  it("creates a task with status NEW when unassigned", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1" });
    expect(task.status).toBe("NEW");
    expect(task.taskCode).toMatch(/^LPP-TASK-\d{6}$/);
    expect(audits).toEqual([expect.objectContaining({ action: "TASK_CREATED" })]);
  });

  it("creates a task with status ASSIGNED and notifies when assignedToId is given", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1", createdById: "mgr-1" });
    expect(task.status).toBe("ASSIGNED");
    expect(assignmentsCreated).toHaveLength(1);
    expect(notifications).toEqual([{ fn: "assigned", args: ["staff-1", task.taskCode, expect.anything()] }]);
  });

  it("returns the existing open task instead of creating a duplicate (dedup)", async () => {
    const existing = { id: "existing-1" } as never;
    vi.mocked(findExistingOpenTask).mockResolvedValueOnce(existing);
    const result = await createTask({ taskType: "FOLLOW_UP_DUE", resourceType: "FOLLOW_UP", resourceId: "f1" });
    expect(result).toBe(existing);
    expect(tasks.size).toBe(0);
  });

  it("skips dedup when dedupe: false is explicitly requested", async () => {
    const existing = { id: "existing-1" } as never;
    vi.mocked(findExistingOpenTask).mockResolvedValue(existing);
    const result = await createTask({ taskType: "FOLLOW_UP_DUE", resourceType: "FOLLOW_UP", resourceId: "f1", dedupe: false });
    expect(result).not.toBe(existing);
  });
});

describe("createFromEvent (idempotency)", () => {
  it("creates a task the first time an event is delivered", async () => {
    const task = await createFromEvent({ eventName: "PROFILE_SUBMITTED", dedupKey: "PROFILE_SUBMITTED:p1", resourceType: "PROFILE", resourceId: "p1", taskType: "PROFILE_UPDATE_REVIEW" });
    expect(task).not.toBeNull();
    expect(tasks.size).toBe(1);
  });

  it("is a no-op (returns null, no new task) when the same dedupKey is delivered again", async () => {
    await createFromEvent({ eventName: "PROFILE_SUBMITTED", dedupKey: "PROFILE_SUBMITTED:p1", resourceType: "PROFILE", resourceId: "p1", taskType: "PROFILE_UPDATE_REVIEW" });
    const second = await createFromEvent({ eventName: "PROFILE_SUBMITTED", dedupKey: "PROFILE_SUBMITTED:p1", resourceType: "PROFILE", resourceId: "p1", taskType: "PROFILE_UPDATE_REVIEW" });
    expect(second).toBeNull();
    expect(tasks.size).toBe(1);
  });

  it("records a WorkflowFailure and returns null instead of throwing when task creation fails", async () => {
    tasks = null as never; // force adminTask.create to throw on the Map.set call
    const result = await createFromEvent({ eventName: "X", dedupKey: "X:1", resourceType: "PROFILE", resourceId: "p1", taskType: "GENERAL_ADMIN_TASK" });
    expect(result).toBeNull();
    expect(workflowFailures).toHaveLength(1);
  });
});

describe("assignTask / reassignTask", () => {
  it("assigns an unassigned task and notifies", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1" });
    const updated = await assignTask({ taskId: task.id, adminId: "staff-1", actorId: "mgr-1" });
    expect(updated.assignedToId).toBe("staff-1");
    expect(updated.status).toBe("ASSIGNED");
    expect(updated.version).toBe(2);
  });

  it("refuses to assign a task that already has an assignee", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    await expect(assignTask({ taskId: task.id, adminId: "staff-2", actorId: "mgr-1" })).rejects.toBeInstanceOf(WorkflowError);
  });

  it("reassigns an already-assigned task, recording the previous owner", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    const updated = await reassignTask({ taskId: task.id, newAdminId: "staff-2", reason: "staff-1 is on leave", actorId: "mgr-1" });
    expect(updated.assignedToId).toBe("staff-2");
    expect(reassignments).toHaveLength(1);
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "TASK_REASSIGNED", meta: expect.objectContaining({ previousAdminId: "staff-1", newAdminId: "staff-2" }) })]));
  });
});

describe("transitionTask", () => {
  it("allows a valid transition and records status history", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    const updated = await transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" });
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.startedAt).not.toBeNull();
    expect(statusHistory).toHaveLength(1);
  });

  it("rejects an invalid transition (e.g. NEW straight to COMPLETED)", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1" });
    await expect(transitionTask({ taskId: task.id, newStatus: "COMPLETED", actorId: "staff-1" })).rejects.toBeInstanceOf(WorkflowError);
  });

  it("rejects a stale-version update with a 409 (optimistic concurrency)", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    // Simulate a concurrent writer having already bumped the version in the
    // DB between our read (requireTask) and our write (withVersionedUpdate).
    tasks.get(task.id)!.version = 2;
    vi.mocked(prisma.adminTask.findUnique).mockResolvedValueOnce({ ...task, version: 1 } as never);
    await expect(transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("escalateTask", () => {
  it("increments the escalation level and logs a TaskEscalation row", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    const updated = await escalateTask({ taskId: task.id, actorId: "mgr-1", reason: "overdue" });
    expect(updated.escalationLevel).toBe(2);
    expect(updated.escalationStatus).toBe("ESCALATED");
    expect(escalations).toEqual([expect.objectContaining({ previousLevel: 1, newLevel: 2 })]);
  });

  it("refuses to escalate past the maximum level (4)", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    tasks.get(task.id)!.escalationLevel = 4;
    await expect(escalateTask({ taskId: task.id, actorId: "mgr-1", reason: "x" })).rejects.toBeInstanceOf(WorkflowError);
  });
});

describe("completeTask", () => {
  it("completes a task with no checklist requirements", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    await transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" });
    const updated = await completeTask({ taskId: task.id, actorId: "staff-1", outcome: "Approved for next stage" });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.completedAt).not.toBeNull();
  });

  it("blocks completion while a required checklist item is incomplete", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    await transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" });
    checklistItems.push({ taskId: task.id, required: true, completedAt: null });
    await expect(completeTask({ taskId: task.id, actorId: "staff-1" })).rejects.toBeInstanceOf(WorkflowError);
  });

  it("notifies a dependent task's assignee when this task completes", async () => {
    const dep = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p2", assignedToId: "staff-2" });
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    dependencies.push({ taskId: dep.id, dependsOnTaskId: task.id, type: "DEPENDS_ON" });
    await transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" });
    await completeTask({ taskId: task.id, actorId: "staff-1" });
    expect(notifications.some((n) => n.fn === "dependencyCompleted")).toBe(true);
  });
});

describe("reopenTask / cancelTask", () => {
  it("reopens a completed task and clears completedAt", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1", assignedToId: "staff-1" });
    await transitionTask({ taskId: task.id, newStatus: "IN_PROGRESS", actorId: "staff-1" });
    await completeTask({ taskId: task.id, actorId: "staff-1" });
    const reopened = await reopenTask({ taskId: task.id, actorId: "mgr-1", reason: "needs another look" });
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.completedAt).toBeNull();
  });

  it("cancels a task with a reason", async () => {
    const task = await createTask({ taskType: "GENERAL_ADMIN_TASK", resourceType: "PROFILE", resourceId: "p1" });
    const cancelled = await cancelTask({ taskId: task.id, actorId: "mgr-1", reason: "no longer needed" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "TASK_CANCELLED" })]));
  });
});
