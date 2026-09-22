import { describe, it, expect, vi } from "vitest";

let assigneeId: string | null = null;
vi.mock("@/lib/admin-assignment", () => ({ getCurrentAssigneeId: async () => assigneeId }));
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";

// STEP 17 §19 "No Assignment = No Record Access" — horizontal-access check:
// an assignment-scoped admin can only act on a profile currently assigned to
// THEM, never a profile assigned to a different staff member, and a
// broad-access role bypasses assignment scoping entirely.
describe("assertProfileAssignmentAccess (horizontal access)", () => {
  it("allows a staff member to act on their own assigned profile", async () => {
    assigneeId = "staff-A";
    await expect(assertProfileAssignmentAccess({ id: "staff-A", role: "STAFF_MATCHMAKER" }, "p1")).resolves.toBeUndefined();
  });

  it("blocks Staff A from acting on a profile assigned to Staff B", async () => {
    assigneeId = "staff-B";
    await expect(assertProfileAssignmentAccess({ id: "staff-A", role: "STAFF_MATCHMAKER" }, "p1")).rejects.toMatchObject({ status: 403 });
  });

  it("blocks an assignment-scoped admin from an unassigned profile", async () => {
    assigneeId = null;
    await expect(assertProfileAssignmentAccess({ id: "staff-A", role: "STAFF_MATCHMAKER" }, "p1")).rejects.toMatchObject({ status: 403 });
  });

  it("lets a broad-access role (e.g. MATCHMAKING_MANAGER) bypass assignment scoping entirely", async () => {
    assigneeId = "staff-B";
    await expect(assertProfileAssignmentAccess({ id: "manager-1", role: "MATCHMAKING_MANAGER" }, "p1")).resolves.toBeUndefined();
  });

  it("lets SUPER_ADMIN bypass assignment scoping entirely", async () => {
    assigneeId = "staff-B";
    await expect(assertProfileAssignmentAccess({ id: "super-1", role: "SUPER_ADMIN" }, "p1")).resolves.toBeUndefined();
  });
});
