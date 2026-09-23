import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess, type AdminRole, type Permission } from "@/lib/permissions";
import { meetsAccessLevel, minAccessLevel, type AccessLevel } from "@/lib/access-level";
import { assertProposalAccess } from "@/lib/proposal-access";
import { assertVerificationAccess } from "@/lib/verification-access";
import { assertSecurityFlagAccess } from "@/lib/security-flag-access";
import { assertFollowUpAccess } from "@/lib/followup-access";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { resolveCaseAccessLevel } from "@/lib/case-access";
import type { AdminTask } from "@prisma/client";

export interface TaskAccessAdmin {
  id: string;
  role: AdminRole;
  permissions: Permission[];
}

// STEP 18 §14 — the literal nine-step chain. A task never grants MORE access
// than the source record's OWN existing rules already allow (§68 "no access
// escalation through tasks") — step 5 below always delegates to the
// per-resource helper that route already trusted before this step existed;
// it is never reimplemented here.
export type TaskAccessDenyReason =
  | "RESTRICTED_VISIBILITY"
  | "NO_TASK_PERMISSION"
  | "NOT_YOUR_TASK"
  | "SOURCE_RECORD_DENIED"
  | "SOURCE_RECORD_NOT_FOUND"
  | "INSUFFICIENT_ACCESS_LEVEL";

export interface TaskAccessResult {
  allowed: boolean;
  level: AccessLevel | null;
  reason: TaskAccessDenyReason | null;
}

async function tryAccess(fn: () => void | Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

// Step 5 — source-record permission. PAYMENT/PRIVACY_REQUEST/AI_SAFETY_EVENT
// have no per-record ACL helper anywhere in this codebase (those domains'
// own authorization is permission-based, not per-record-assignment-based),
// so task access there is deliberately capped at what the domain's own
// permission strings already grant — never a new, stronger per-record ACL.
async function resolveSourceRecordLevel(admin: TaskAccessAdmin, task: AdminTask): Promise<AccessLevel | null> {
  switch (task.resourceType) {
    case "PROPOSAL": {
      const proposal = await prisma.proposal.findUnique({ where: { id: task.resourceId }, select: { assignedToId: true } });
      if (!proposal) return null;
      return (await tryAccess(() => assertProposalAccess(admin, proposal))) ? "MANAGE" : null;
    }
    case "VERIFICATION": {
      const verification = await prisma.profileVerification.findUnique({ where: { id: task.resourceId }, select: { assignedToId: true } });
      if (!verification) return null;
      return (await tryAccess(() => assertVerificationAccess(admin, verification))) ? "MANAGE" : null;
    }
    case "SECURITY_FLAG": {
      const flag = await prisma.securityFlag.findUnique({ where: { id: task.resourceId }, select: { assignedToId: true } });
      if (!flag) return null;
      return (await tryAccess(() => assertSecurityFlagAccess(admin, flag))) ? "MANAGE" : null;
    }
    case "FOLLOW_UP": {
      const followUp = await prisma.followUp.findUnique({ where: { id: task.resourceId }, select: { id: true, adminId: true } });
      if (!followUp) return null;
      return (await tryAccess(() => assertFollowUpAccess(admin, followUp))) ? "MANAGE" : null;
    }
    case "PROFILE": {
      const profile = await prisma.profile.findUnique({ where: { id: task.resourceId }, select: { id: true } });
      if (!profile) return null;
      return (await tryAccess(() => assertProfileAssignmentAccess(admin, task.resourceId))) ? "MANAGE" : null;
    }
    case "CASE": {
      const caseRecord = await prisma.case.findUnique({ where: { id: task.resourceId }, select: { id: true, reportedAdminId: true } });
      if (!caseRecord) return null;
      const level = await resolveCaseAccessLevel(admin, caseRecord);
      // CaseAccessLevel's VIEW/COMMENT/EDIT/MANAGE names are drop-in
      // compatible with AccessLevel by design (src/lib/access-level.ts).
      return level === "NONE" ? null : (level as AccessLevel);
    }
    case "PAYMENT":
      if (admin.permissions.includes("finance:payments:manage")) return "MANAGE";
      if (admin.permissions.includes("finance:payments:view")) return "VIEW";
      return null;
    case "PRIVACY_REQUEST":
      if (admin.permissions.includes("privacy:requests:manage")) return "MANAGE";
      if (admin.permissions.includes("privacy:requests:view")) return "VIEW";
      return null;
    case "AI_SAFETY_EVENT":
      if (admin.permissions.includes("ai:config:manage") || admin.permissions.includes("ai:killswitch")) return "MANAGE";
      if (admin.permissions.includes("ai:activity:view")) return "VIEW";
      return null;
    case "ADMIN_TASK":
      // A task about another task (rare — e.g. a manual follow-up task on a
      // stuck workflow task) — broad-access only, no dedicated ACL exists.
      return hasBroadRecordAccess(admin.role) ? "MANAGE" : null;
    default:
      return null;
  }
}

// Steps 1-9 of spec §14. Step 1 (authenticate) is the caller's
// requireAdmin() having already run before this is ever invoked. Steps 8/9
// (consent/workflow, field filtering) are deliberately NOT reimplemented
// generically here — a domain action that itself requires consent (e.g.
// approving contact sharing) still goes through its own dedicated route,
// which independently calls src/lib/privacy/contact-access.ts; this
// resolver only ever narrows access, never widens it, so skipping a
// domain-specific consent check here can't grant something the underlying
// route wouldn't already re-check for itself.
export async function resolveTaskAccessLevel(admin: TaskAccessAdmin, task: AdminTask): Promise<TaskAccessResult> {
  const deny = (reason: TaskAccessDenyReason): TaskAccessResult => ({ allowed: false, level: null, reason });

  const isBroad = hasBroadRecordAccess(admin.role);
  const isAssignee = task.assignedToId === admin.id;

  // Step 2/7 — role + sensitive visibility. A RESTRICTED task is visible
  // only to broad-access roles and its own assignee — an org-wide "team" or
  // "all work" viewer never sees it merely by department/role breadth.
  if (task.visibility === "RESTRICTED" && !isBroad && !isAssignee) {
    return deny("RESTRICTED_VISIBILITY");
  }

  // Step 3/4 — task permission + assignment scope. An unassigned task is
  // "No Assignment = No Record Access" for a scoped role (STEP 17 §19
  // precedent) — only a broad role or explicit tasks:view:all can see it.
  if (!admin.permissions.includes("tasks:view")) return deny("NO_TASK_PERMISSION");
  const inScope = isBroad || isAssignee || admin.permissions.includes("tasks:view:all");
  if (!inScope) return deny("NOT_YOUR_TASK");

  // Step 5 — source-record permission, delegated to the existing helpers.
  const sourceLevel = await resolveSourceRecordLevel(admin, task);
  if (sourceLevel === null) return deny("SOURCE_RECORD_DENIED");

  // Step 6 — the task's own accessLevel caps whatever the source record
  // would otherwise allow (never more than what this specific task grants).
  const level = minAccessLevel(sourceLevel, task.accessLevel as AccessLevel);
  return { allowed: true, level, reason: null };
}

// The actual gate every task route calls. IDOR-hardened by construction:
// `task` must be the freshly-fetched DB row for the given id — resourceType/
// resourceId are read from it, never from client input, so tampering with a
// request body's sourceId/resourceType has zero effect on the check.
export async function assertTaskAccess(admin: TaskAccessAdmin, task: AdminTask, minLevel: AccessLevel, action = `require:${minLevel}`): Promise<AccessLevel> {
  const result = await resolveTaskAccessLevel(admin, task);
  const sufficientLevel = result.level !== null && meetsAccessLevel(result.level, minLevel);
  const allowed = result.allowed && sufficientLevel;

  await prisma.taskAccessLog.create({
    data: {
      taskId: task.id,
      adminId: admin.id,
      action,
      allowed,
      denyReason: allowed ? null : (result.reason ?? "INSUFFICIENT_ACCESS_LEVEL"),
    },
  });

  if (!allowed) {
    throw new ApiError(403, "You do not have sufficient access to this task.");
  }
  return result.level as AccessLevel;
}
