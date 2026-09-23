import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { escalateTask, retryWorkflowEvent, notifyTaskDueSoon, notifyTaskOverdue } = vi.hoisted(() => ({
  escalateTask: vi.fn(async () => ({})),
  retryWorkflowEvent: vi.fn(async () => ({ ok: true })),
  notifyTaskDueSoon: vi.fn(async () => {}),
  notifyTaskOverdue: vi.fn(async () => {}),
}));

vi.mock("@/lib/workflow/engine", () => ({ escalateTask }));
vi.mock("@/lib/workflow/retry", () => ({ retryWorkflowEvent }));
vi.mock("@/lib/notifications/events", () => ({ notifyTaskDueSoon, notifyTaskOverdue }));

interface TaskRow {
  id: string;
  dueAt: Date | null;
  escalationLevel: number;
  escalationStatus: string;
  assignedToId: string | null;
  taskCode: string | null;
  title: string | null;
  taskType: string;
}
let tasks: TaskRow[];
let failedEvents: Array<{ id: string }>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminTask: { findMany: vi.fn(async () => tasks) },
    workflowEvent: { findMany: vi.fn(async () => failedEvents) },
  },
}));

import { runWorkflowAutomationSweep } from "@/lib/workflow/automation-sweep";

const now = new Date("2026-01-02T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  tasks = [];
  failedEvents = [];
  escalateTask.mockClear();
  retryWorkflowEvent.mockClear();
  notifyTaskDueSoon.mockClear();
  notifyTaskOverdue.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runWorkflowAutomationSweep — SLA breach auto-escalation", () => {
  it("escalates and notifies an overdue task that has not already been escalated", async () => {
    tasks = [{ id: "t1", dueAt: new Date(now.getTime() - 1000), escalationLevel: 1, escalationStatus: "NONE", assignedToId: "staff-1", taskCode: "LPP-TASK-000001", title: null, taskType: "GENERAL_ADMIN_TASK" }];
    const result = await runWorkflowAutomationSweep();
    expect(result.escalated).toBe(1);
    expect(result.overdueNotified).toBe(1);
    expect(escalateTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", actorId: null, auto: true }));
  });

  it("does not re-escalate a task that is already escalated (still notifies overdue, but escalation is idempotent)", async () => {
    tasks = [{ id: "t1", dueAt: new Date(now.getTime() - 1000), escalationLevel: 2, escalationStatus: "ESCALATED", assignedToId: "staff-1", taskCode: null, title: null, taskType: "GENERAL_ADMIN_TASK" }];
    const result = await runWorkflowAutomationSweep();
    expect(result.escalated).toBe(0);
    expect(escalateTask).not.toHaveBeenCalled();
  });

  it("never escalates past the maximum level even automatically", async () => {
    tasks = [{ id: "t1", dueAt: new Date(now.getTime() - 1000), escalationLevel: 4, escalationStatus: "NONE", assignedToId: "staff-1", taskCode: null, title: null, taskType: "GENERAL_ADMIN_TASK" }];
    await runWorkflowAutomationSweep();
    expect(escalateTask).not.toHaveBeenCalled();
  });

  it("notifies (but does not escalate) a task that is due soon, not yet overdue", async () => {
    tasks = [{ id: "t1", dueAt: new Date(now.getTime() + 60 * 60 * 1000), escalationLevel: 1, escalationStatus: "NONE", assignedToId: "staff-1", taskCode: null, title: null, taskType: "GENERAL_ADMIN_TASK" }];
    const result = await runWorkflowAutomationSweep();
    expect(result.dueSoonNotified).toBe(1);
    expect(escalateTask).not.toHaveBeenCalled();
  });

  it("skips a task with no due date entirely (no SLA configured)", async () => {
    tasks = [{ id: "t1", dueAt: null, escalationLevel: 1, escalationStatus: "NONE", assignedToId: "staff-1", taskCode: null, title: null, taskType: "GENERAL_ADMIN_TASK" }];
    const result = await runWorkflowAutomationSweep();
    expect(result.escalated).toBe(0);
    expect(result.overdueNotified).toBe(0);
    expect(result.dueSoonNotified).toBe(0);
  });
});

describe("runWorkflowAutomationSweep — automation retry", () => {
  it("attempts a retry for every FAILED event under the cap and tallies success/failure", async () => {
    failedEvents = [{ id: "e1" }, { id: "e2" }];
    retryWorkflowEvent.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    const result = await runWorkflowAutomationSweep();
    expect(result.retried).toBe(1);
    expect(result.stillFailed).toBe(1);
    expect(retryWorkflowEvent).toHaveBeenCalledTimes(2);
  });
});
