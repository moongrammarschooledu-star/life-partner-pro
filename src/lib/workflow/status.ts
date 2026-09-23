import type { AdminTaskStatus } from "@prisma/client";

// STEP 18 §4 — every status transition is validated server-side through this
// table; nothing sets AdminTask.status directly except src/lib/workflow/engine.ts's
// transitionTask(). PENDING is the retired legacy status (STEP 11) — kept
// reachable only from itself/its own historical transitions so an old row
// never gets stuck, but never produced by a new task (see admin-tasks.ts's
// compatibility shim, which always creates with status NEW).
export const ALLOWED_TRANSITIONS: Record<AdminTaskStatus, AdminTaskStatus[]> = {
  PENDING: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "ASSIGNED"],
  NEW: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "IN_PROGRESS", "CANCELLED", "ESCALATED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED", "ESCALATED"],
  IN_PROGRESS: ["WAITING_FOR_USER", "WAITING_FOR_STAFF", "WAITING_FOR_APPROVAL", "BLOCKED", "COMPLETED", "CANCELLED", "ESCALATED"],
  WAITING_FOR_USER: ["IN_PROGRESS", "CANCELLED", "ESCALATED", "EXPIRED"],
  WAITING_FOR_STAFF: ["IN_PROGRESS", "CANCELLED", "ESCALATED"],
  WAITING_FOR_APPROVAL: ["COMPLETED", "IN_PROGRESS", "CANCELLED", "ESCALATED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED", "ESCALATED"],
  ESCALATED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["ARCHIVED", "REOPENED"],
  CANCELLED: ["ARCHIVED", "REOPENED"],
  EXPIRED: ["ARCHIVED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "ASSIGNED", "CANCELLED"],
  ARCHIVED: [],
};

// "Still open" — used for dashboard/queue counts and the §54 dedup check
// (an equivalent open task already exists for this source+type).
export const ACTIVE_TASK_STATUSES: AdminTaskStatus[] = [
  "PENDING",
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "WAITING_FOR_STAFF",
  "WAITING_FOR_APPROVAL",
  "BLOCKED",
  "ESCALATED",
  "REOPENED",
];

export const TERMINAL_TASK_STATUSES: AdminTaskStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED", "ARCHIVED"];

// Narrower than ACTIVE_TASK_STATUSES — "not yet actively worked on," the
// direct successor to the pre-STEP-18 single "PENDING" status used by
// src/lib/dashboard/staff-dashboard.ts's pendingTasks count.
export const NOT_STARTED_TASK_STATUSES: AdminTaskStatus[] = ["PENDING", "NEW", "ASSIGNED"];

export function isValidTransition(from: AdminTaskStatus, to: AdminTaskStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
