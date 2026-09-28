import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { createFromEvent } from "@/lib/workflow/engine";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { notifyAdmins, sendNotification } from "@/lib/notifications/notification-service";
import { suspendProfile, setVerificationStatus } from "@/lib/verification/status";
import { applyRiskRestrictions, liftRiskRestrictionsForCase, resolveRestrictionTypes } from "@/lib/risk/restriction-service";
import { getEffectiveRule } from "@/lib/risk/config";
import type { SessionAdmin } from "@/lib/route-guard";
import type { AssignmentPriority, FalsePositiveReason, NotificationType, RiskCase, RiskLevel, RiskSignalCategory } from "@prisma/client";
import type { AdminRole } from "@/lib/permissions";

// RiskReviewService / case lifecycle. The design constraint the whole feature
// hangs on: this file contains the ONLY paths that restrict or suspend an
// account for a risk reason, and every one of them requires a human actor, a
// completed review checklist, a written reason, and (via the STEP 19 gate) a
// second approver where policy demands it. Nothing here is reachable from the
// rule engine or from an AI feature.

export { ACTIVE_CASE_STATUSES, LEVEL_ORDER, ADVERSE_CHECKLIST_KEYS, isActionAllowed, type RiskCaseAction } from "@/lib/risk/case-actions";
import { ACTIVE_CASE_STATUSES, LEVEL_ORDER, ADVERSE_CHECKLIST_KEYS, TERMINAL_CASE_STATUSES, TRANSITIONS, type RiskCaseAction } from "@/lib/risk/case-actions";

export function assertChecklistComplete(checklist: Record<string, unknown> | undefined): void {
  const missing = ADVERSE_CHECKLIST_KEYS.filter((k) => checklist?.[k] !== true);
  if (missing.length > 0) throw new HttpError(422, `Complete the review checklist first (${missing.join(", ")}).`);
}

export function canViewCase(actor: Pick<SessionAdmin, "id" | "permissions">, c: { subjectAdminId: string | null }): boolean {
  if (!c.subjectAdminId) return true; // route-level permission (risk:view) applies
  if (c.subjectAdminId === actor.id) return false; // an admin can never see or act on a case about themselves
  return actor.permissions.includes("sensitive:security:view") || actor.permissions.includes("security:incidents:manage");
}

function priorityFor(level: RiskLevel): AssignmentPriority {
  return level === "CRITICAL" ? "URGENT" : level === "HIGH" ? "HIGH" : "NORMAL";
}

async function addCaseEvent(riskCaseId: string, eventType: string, summary: string, actorAdminId?: string | null, payload?: Record<string, unknown>) {
  await prisma.riskCaseEvent.create({
    data: { riskCaseId, eventType, summary, actorAdminId: actorAdminId ?? null, payload: payload ? JSON.stringify(payload) : null },
  });
}

// ---------- open / link ----------

export interface OpenRiskCaseParams {
  subjectProfileId?: string | null;
  subjectAdminId?: string | null;
  category: RiskSignalCategory;
  title: string;
  riskLevel: RiskLevel;
  openedBy: string;
  signalIds?: string[];
  userReportId?: string | null;
  caseId?: string | null;
  jurisdictionId?: string | null;
  actorId?: string | null;
}

export async function openRiskCase(params: OpenRiskCaseParams): Promise<{ riskCase: RiskCase; created: boolean }> {
  if (!params.subjectProfileId && !params.subjectAdminId) throw new HttpError(422, "A risk case needs a subject.");

  const existing = await prisma.riskCase.findFirst({
    where: {
      status: { in: ACTIVE_CASE_STATUSES },
      category: params.category,
      ...(params.subjectAdminId ? { subjectAdminId: params.subjectAdminId } : { subjectProfileId: params.subjectProfileId ?? undefined }),
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    // One live case per subject+category: new evidence is linked, never a second case.
    if (params.signalIds?.length) {
      await prisma.securityFlag.updateMany({ where: { id: { in: params.signalIds } }, data: { riskCaseId: existing.id } });
      await addCaseEvent(existing.id, "SIGNAL_LINKED", `${params.signalIds.length} signal(s) linked to this case.`, params.actorId, { signalIds: params.signalIds });
    }
    if (LEVEL_ORDER[params.riskLevel] > LEVEL_ORDER[existing.riskLevel]) {
      const bumped = await prisma.riskCase.update({ where: { id: existing.id }, data: { riskLevel: params.riskLevel } });
      await addCaseEvent(existing.id, "LEVEL_CHANGED", `Level changed ${existing.riskLevel} → ${params.riskLevel}.`, params.actorId);
      return { riskCase: bumped, created: false };
    }
    return { riskCase: existing, created: false };
  }

  const reviewDueHours = ((await getEffectiveRule("case_policy")).config.reviewDueHours as number) ?? 72;
  const riskCode = await nextSequenceCode("RISK");
  const riskCase = await prisma.riskCase.create({
    data: {
      riskCode,
      subjectProfileId: params.subjectProfileId ?? null,
      subjectAdminId: params.subjectAdminId ?? null,
      category: params.category,
      title: params.title,
      riskLevel: params.riskLevel,
      riskState: params.riskLevel === "LOW" ? "LOW" : "UNDER_REVIEW",
      reviewRequired: true,
      openedBy: params.openedBy,
      userReportId: params.userReportId ?? null,
      caseId: params.caseId ?? null,
      jurisdictionId: params.jurisdictionId ?? null,
      dueAt: new Date(Date.now() + reviewDueHours * 3_600_000),
    },
  });
  if (params.signalIds?.length) await prisma.securityFlag.updateMany({ where: { id: { in: params.signalIds } }, data: { riskCaseId: riskCase.id } });

  await addCaseEvent(riskCase.id, "CASE_OPENED", `Case opened (${params.openedBy}). Review is required; no action has been taken.`, params.actorId, { signalIds: params.signalIds ?? [] });
  await writeAudit({
    action: "RISK_CASE_OPENED",
    adminId: params.actorId ?? null,
    targetProfileId: params.subjectProfileId ?? null,
    meta: { riskCaseId: riskCase.id, riskCode, level: params.riskLevel, category: params.category, openedBy: params.openedBy },
  });

  // Neutral, code-only task title: never names the person or the suspicion.
  await createFromEvent({
    eventName: "RISK_CASE_OPENED",
    dedupKey: `RISK_REVIEW:${riskCase.id}`,
    resourceType: params.subjectAdminId ? "ADMIN_USER" : "PROFILE",
    resourceId: (params.subjectAdminId ?? params.subjectProfileId) as string,
    taskType: params.subjectAdminId ? "ADMIN_SECURITY_REVIEW" : "RISK_REVIEW",
    priority: priorityFor(params.riskLevel),
    title: params.subjectAdminId ? `Privileged-access review ${riskCode}` : `Risk review ${riskCode}`,
    description: "A risk case requires human review. No adverse action has been taken.",
  });

  await notifyCaseOpened(riskCase);
  return { riskCase, created: true };
}

async function notifyCaseOpened(riskCase: RiskCase) {
  const type: NotificationType = riskCase.subjectAdminId
    ? "ADMIN_ACCESS_ANOMALY"
    : riskCase.riskLevel === "CRITICAL"
      ? "CRITICAL_RISK_DETECTED"
      : riskCase.riskLevel === "HIGH"
        ? "HIGH_RISK_DETECTED"
        : riskCase.category === "IDENTITY"
          ? "VERIFICATION_RISK"
          : "ACCOUNT_SECURITY_ALERT";
  const roles: AdminRole[] = riskCase.subjectAdminId ? ["COMPLIANCE_MANAGER"] : ["VERIFICATION_MANAGER", "SUPPORT_MANAGER"];

  if (riskCase.subjectAdminId) {
    // Never notify the subject of an admin-subject case, even a SUPER_ADMIN.
    const admins = await prisma.adminUser.findMany({ where: { active: true, role: { in: ["SUPER_ADMIN", ...roles] as never[] }, id: { not: riskCase.subjectAdminId } }, select: { id: true } });
    await Promise.all(admins.map((a) => sendNotification({ adminId: a.id, type, data: {} })));
    return;
  }
  await notifyAdmins({ type, data: { relatedProfileId: riskCase.subjectProfileId ?? undefined }, roles });
}

// ---------- actions ----------

export interface CaseActionParams {
  action: RiskCaseAction;
  actor: SessionAdmin;
  notes?: string;
  reason?: string;
  checklist?: Record<string, unknown>;
  falsePositiveReason?: FalsePositiveReason;
  restrictionTypes?: string[];
  endDate?: Date | null;
  permanent?: boolean;
  outcome?: string;
}

export type CaseActionResult =
  | { approvalRequired: false; riskCase: RiskCase }
  | { approvalRequired: true; approvalCode: string; status: string; riskCase: RiskCase };

export async function getRiskCaseForActor(caseId: string, actor: Pick<SessionAdmin, "id" | "permissions">) {
  const riskCase = await prisma.riskCase.findUnique({ where: { id: caseId } });
  // Same 404 for "does not exist" and "not yours to see" — no existence oracle.
  if (!riskCase || !canViewCase(actor, riskCase)) throw new HttpError(404, "Risk case not found.");
  return riskCase;
}

export async function applyCaseAction(caseId: string, params: CaseActionParams): Promise<CaseActionResult> {
  const { action, actor } = params;
  const riskCase = await getRiskCaseForActor(caseId, actor);
  const rule = TRANSITIONS[action];

  if (!rule.from.includes(riskCase.status)) throw new HttpError(409, `Action ${action} is not allowed while the case is ${riskCase.status}.`);

  const needsReason: RiskCaseAction[] = ["DISMISS", "MARK_FALSE_POSITIVE", "CLEAR", "RESTRICT", "SUSPEND", "ESCALATE", "REQUEST_REVERIFICATION"];
  const reason = (params.reason ?? params.notes ?? "").trim();
  if (needsReason.includes(action) && reason.length < 5) throw new HttpError(422, "A reason is required for this action.");
  if (action === "CLOSE" && !params.outcome?.trim()) throw new HttpError(422, "An outcome summary is required to close a case.");
  if (action === "MARK_FALSE_POSITIVE" && !params.falsePositiveReason) throw new HttpError(422, "A structured false-positive reason is required.");

  const profileId = riskCase.subjectProfileId;
  const profileOnly: RiskCaseAction[] = ["RESTRICT", "SUSPEND", "REQUEST_INFORMATION", "REQUEST_REVERIFICATION"];
  if (profileOnly.includes(action) && !profileId) throw new HttpError(422, "This action applies to applicant accounts only; use admin account management for staff.");

  let approvalId: string | null = null;

  if (action === "RESTRICT") {
    assertChecklistComplete(params.checklist);
    const types = resolveRestrictionTypes(params.restrictionTypes ?? []);
    const gate = await enforceApprovalGate({
      actionType: params.permanent ? "PERMANENT_RESTRICTION" : "PROFILE_RESTRICT",
      sourceType: "PROFILE",
      sourceId: profileId as string,
      actor,
      reason,
      requestedPayload: { riskCaseId: caseId, restrictionTypes: types, endDate: params.endDate?.toISOString() ?? null, permanent: params.permanent === true },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status, riskCase };
    approvalId = gate.requiresApproval ? gate.approvalRequestId : null;
    // A permanent restriction that the policy does NOT gate would bypass the
    // spec's rule, so permanence with no approval on record is refused.
    if (params.permanent && !approvalId) throw new HttpError(403, "A permanent restriction requires an approved PERMANENT_RESTRICTION request.");

    await applyRiskRestrictions({ profileId: profileId as string, types, reason, actorId: actor.id, riskCaseId: caseId, endDate: params.endDate, isPermanent: params.permanent === true, approvalId });
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  }

  if (action === "SUSPEND") {
    assertChecklistComplete(params.checklist);
    const gate = await enforceApprovalGate({ actionType: "PROFILE_SUSPEND", sourceType: "PROFILE", sourceId: profileId as string, actor, reason, requestedPayload: { riskCaseId: caseId } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status, riskCase };
    approvalId = gate.requiresApproval ? gate.approvalRequestId : null;
    await suspendProfile(profileId as string, { adminId: actor.id, reason: `Risk review ${riskCase.riskCode}: ${reason}` });
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  }

  if (action === "REQUEST_INFORMATION") {
    await sendNotification({ profileId: profileId as string, type: "RISK_INFORMATION_REQUESTED", data: {} });
  }
  if (action === "REQUEST_REVERIFICATION") {
    await setVerificationStatus(profileId as string, "RE_VERIFICATION_REQUIRED", { adminId: actor.id, reVerificationReason: "Additional verification requested during a safety review." });
    await sendNotification({ profileId: profileId as string, type: "RISK_INFORMATION_REQUESTED", data: {} });
  }

  const signalStatus =
    action === "DISMISS" ? "DISMISSED" : action === "MARK_FALSE_POSITIVE" ? "FALSE_POSITIVE" : action === "CLEAR" ? "RESOLVED" : action === "ESCALATE" ? "ESCALATED" : action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : action === "INVESTIGATE" ? "INVESTIGATING" : null;
  if (signalStatus) {
    const closing = ["DISMISSED", "FALSE_POSITIVE", "RESOLVED"].includes(signalStatus);
    await prisma.securityFlag.updateMany({
      where: { riskCaseId: caseId, status: { in: ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "ESCALATED"] } },
      data: {
        status: signalStatus,
        ...(closing ? { resolution: reason || "Closed with the risk case.", resolvedById: actor.id, resolvedAt: new Date() } : {}),
        ...(signalStatus === "FALSE_POSITIVE" ? { falsePositiveReason: params.falsePositiveReason } : {}),
      },
    });
  }

  let liftedRestrictions = 0;
  if (action === "CLEAR") liftedRestrictions = await liftRiskRestrictionsForCase(caseId, actor.id);

  const closing = rule.to && TERMINAL_CASE_STATUSES.includes(rule.to);
  const updated = await prisma.riskCase.update({
    where: { id: caseId },
    data: {
      ...(rule.to ? { status: rule.to } : {}),
      ...(rule.state ? { riskState: rule.state } : {}),
      ...(action === "INVESTIGATE" && !riskCase.assignedToId ? { assignedToId: actor.id } : {}),
      ...(closing ? { closedAt: new Date(), closedById: actor.id, outcome: params.outcome?.trim() ?? (reason || action) } : {}),
    },
  });

  await prisma.riskReview.create({
    data: {
      riskCaseId: caseId,
      reviewerId: actor.id,
      decision: action,
      notes: reason || null,
      checklist: params.checklist ? JSON.stringify(params.checklist) : null,
      approvalId,
    },
  });
  await addCaseEvent(caseId, "REVIEW_ACTION", `${action} by a reviewer${reason ? `: ${reason}` : ""}`, actor.id, {
    action,
    from: riskCase.status,
    to: updated.status,
    approvalId,
    liftedRestrictions,
    ...(params.falsePositiveReason ? { falsePositiveReason: params.falsePositiveReason } : {}),
  });
  await writeAudit({
    action: "RISK_CASE_ACTION",
    adminId: actor.id,
    targetProfileId: profileId,
    meta: { riskCaseId: caseId, riskCode: riskCase.riskCode, action, from: riskCase.status, to: updated.status, approvalId },
  });

  if (action === "ESCALATE") {
    await notifyAdmins({ type: "RISK_CASE_ESCALATED", data: { relatedProfileId: profileId ?? undefined }, roles: ["COMPLIANCE_MANAGER", "SUPPORT_MANAGER"] });
  }

  return { approvalRequired: false, riskCase: updated };
}

export async function addCaseNote(caseId: string, actor: SessionAdmin, note: string) {
  const riskCase = await getRiskCaseForActor(caseId, actor);
  const text = note.trim();
  if (text.length < 2) throw new HttpError(422, "A note is required.");
  await addCaseEvent(riskCase.id, "NOTE", text.slice(0, 2000), actor.id);
  return riskCase;
}

export async function assignCase(caseId: string, actor: SessionAdmin, assigneeId: string) {
  const riskCase = await getRiskCaseForActor(caseId, actor);
  if (riskCase.subjectAdminId === assigneeId) throw new HttpError(422, "A case cannot be assigned to its own subject.");
  const updated = await prisma.riskCase.update({ where: { id: riskCase.id }, data: { assignedToId: assigneeId } });
  await addCaseEvent(riskCase.id, "ASSIGNED", "Case assigned.", actor.id, { assigneeId });
  return updated;
}
