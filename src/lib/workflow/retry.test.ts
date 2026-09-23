import { describe, it, expect, vi, beforeEach } from "vitest";

const audits: Array<{ action: string; adminId?: string | null; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => { audits.push(p); } }));

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));
vi.mock("@/lib/workflow/engine", () => ({ createTask }));

interface EventRow {
  id: string;
  status: string;
  attempts: number;
  sourceType: string;
  sourceId: string;
  payload: Record<string, unknown> | null;
}
let events: Map<string, EventRow>;
let failures: Array<Record<string, unknown>> = [];
let failureRows: Map<string, { id: string; resolvedAt: Date | null }>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowEvent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => events.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = events.get(where.id)!;
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in (value as object)) {
            (row as unknown as Record<string, number>)[key] += (value as { increment: number }).increment;
          } else {
            (row as unknown as Record<string, unknown>)[key] = value;
          }
        }
        return row;
      }),
    },
    workflowFailure: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { failures.push(data); return data; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = failureRows.get(where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { retryWorkflowEvent, resolveWorkflowFailure } from "@/lib/workflow/retry";

beforeEach(() => {
  audits.length = 0;
  failures.length = 0;
  events = new Map();
  failureRows = new Map([["fail-1", { id: "fail-1", resolvedAt: null }]]);
  createTask.mockReset();
});

describe("retryWorkflowEvent", () => {
  it("is a no-op success for an already-PROCESSED event", async () => {
    events.set("e1", { id: "e1", status: "PROCESSED", attempts: 1, sourceType: "PROFILE", sourceId: "p1", payload: {} });
    const result = await retryWorkflowEvent("e1", null);
    expect(result.ok).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("refuses to retry past the max attempt cap, leaving the event visibly FAILED for manual handling", async () => {
    events.set("e1", { id: "e1", status: "FAILED", attempts: 5, sourceType: "PROFILE", sourceId: "p1", payload: { taskType: "GENERAL_ADMIN_TASK" } });
    const result = await retryWorkflowEvent("e1", null);
    expect(result.ok).toBe(false);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("successfully creates the task and marks the event PROCESSED", async () => {
    events.set("e1", { id: "e1", status: "FAILED", attempts: 1, sourceType: "PROFILE", sourceId: "p1", payload: { taskType: "GENERAL_ADMIN_TASK" } });
    createTask.mockResolvedValueOnce({ id: "task-1" });
    const result = await retryWorkflowEvent("e1", "admin-1");
    expect(result.ok).toBe(true);
    expect(events.get("e1")!.status).toBe("PROCESSED");
    expect(audits).toEqual([expect.objectContaining({ action: "WORKFLOW_FAILURE_RETRIED" })]);
  });

  it("increments attempts and logs a new WorkflowFailure when the retry itself fails", async () => {
    events.set("e1", { id: "e1", status: "FAILED", attempts: 1, sourceType: "PROFILE", sourceId: "p1", payload: { taskType: "GENERAL_ADMIN_TASK" } });
    createTask.mockRejectedValueOnce(new Error("db unavailable"));
    const result = await retryWorkflowEvent("e1", null);
    expect(result.ok).toBe(false);
    expect(events.get("e1")!.attempts).toBe(2);
    expect(failures).toHaveLength(1);
  });

  it("never silently discards an event — missing taskType in payload is a reported failure, not a swallowed no-op", async () => {
    events.set("e1", { id: "e1", status: "FAILED", attempts: 0, sourceType: "PROFILE", sourceId: "p1", payload: {} });
    const result = await retryWorkflowEvent("e1", null);
    expect(result.ok).toBe(false);
    expect(failures).toHaveLength(1);
  });
});

describe("resolveWorkflowFailure", () => {
  it("marks a failure resolved and audits the action", async () => {
    await resolveWorkflowFailure("fail-1", "admin-1", "RESOLVED", "Investigated — was a transient DB blip.");
    expect(failureRows.get("fail-1")!.resolvedAt).not.toBeNull();
    expect(audits).toEqual([expect.objectContaining({ action: "WORKFLOW_FAILURE_RESOLVED" })]);
  });
});
