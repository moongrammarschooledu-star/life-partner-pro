import { describe, it, expect, vi, beforeEach } from "vitest";

let tasks: Array<{ id: string; resourceType: string; resourceId: string; taskType: string; status: string; createdAt: Date }>;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminTask: {
      findFirst: vi.fn(({ where }: { where: { resourceType: string; resourceId: string; taskType: string; status: { in: string[] } } }) => {
        const matches = tasks.filter(
          (t) => t.resourceType === where.resourceType && t.resourceId === where.resourceId && t.taskType === where.taskType && where.status.in.includes(t.status)
        );
        matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(matches[0] ?? null);
      }),
    },
  },
}));

import { findExistingOpenTask } from "@/lib/workflow/dedup";

beforeEach(() => {
  tasks = [];
});

// STEP 18 §54 — the direct regression test for the pre-existing
// sendOverdueFollowUpAlerts() bug: a duplicate task must never be created
// for the same source record + task type while one is still open.
describe("findExistingOpenTask", () => {
  it("finds an existing open task for the same source + type", async () => {
    tasks = [{ id: "t1", resourceType: "FOLLOW_UP", resourceId: "f1", taskType: "FOLLOW_UP_DUE", status: "NEW", createdAt: new Date() }];
    const found = await findExistingOpenTask("FOLLOW_UP", "f1", "FOLLOW_UP_DUE");
    expect(found?.id).toBe("t1");
  });

  it("does not match a task that has already been completed/cancelled/archived", async () => {
    tasks = [{ id: "t1", resourceType: "FOLLOW_UP", resourceId: "f1", taskType: "FOLLOW_UP_DUE", status: "COMPLETED", createdAt: new Date() }];
    expect(await findExistingOpenTask("FOLLOW_UP", "f1", "FOLLOW_UP_DUE")).toBeNull();
  });

  it("does not match a different task type on the same source record", async () => {
    tasks = [{ id: "t1", resourceType: "FOLLOW_UP", resourceId: "f1", taskType: "CASE_REVIEW", status: "NEW", createdAt: new Date() }];
    expect(await findExistingOpenTask("FOLLOW_UP", "f1", "FOLLOW_UP_DUE")).toBeNull();
  });

  it("does not match the same task type on a different source record", async () => {
    tasks = [{ id: "t1", resourceType: "FOLLOW_UP", resourceId: "other", taskType: "FOLLOW_UP_DUE", status: "NEW", createdAt: new Date() }];
    expect(await findExistingOpenTask("FOLLOW_UP", "f1", "FOLLOW_UP_DUE")).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    expect(await findExistingOpenTask("FOLLOW_UP", "f1", "FOLLOW_UP_DUE")).toBeNull();
  });
});
