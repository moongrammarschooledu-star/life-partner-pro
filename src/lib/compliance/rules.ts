import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { createTask, createFromEvent } from "@/lib/workflow/engine";
import { notifyAdmins } from "@/lib/notifications/notification-service";
import type { SessionAdmin } from "@/lib/route-guard";
import type { ComplianceSourceType } from "@prisma/client";

// ComplianceRule state machine (plan decision 3): DRAFT -> UNDER_REVIEW ->
// APPROVED -> ACTIVE -> SUSPENDED/EXPIRED/RETIRED. Only ACTIVE rules may
// affect production behavior (spec §6) — rule-engine.ts's findActiveRules()
// enforces that on the read side; this file enforces the write-side
// transitions and the maker-checker gate on activation.

export interface CreateRuleInput {
  jurisdictionId: string;
  subject: string;
  requirementType: string;
  description: string;
  sourceType: ComplianceSourceType;
  sourceTitle?: string;
  sourceAuthority?: string;
  sourceReference?: string;
  sourceUrl?: string;
  sourcePublicationDate?: Date;
  internalReviewNote?: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  reviewDate?: Date;
  configuration: unknown;
}

export async function createRule(input: CreateRuleInput, actor: SessionAdmin) {
  const rule = await prisma.complianceRule.create({
    data: {
      ruleCode: await nextSequenceCode("CRULE"),
      jurisdictionId: input.jurisdictionId,
      subject: input.subject,
      requirementType: input.requirementType,
      description: input.description,
      sourceType: input.sourceType,
      sourceTitle: input.sourceTitle ?? null,
      sourceAuthority: input.sourceAuthority ?? null,
      sourceReference: input.sourceReference ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourcePublicationDate: input.sourcePublicationDate ?? null,
      internalReviewNote: input.internalReviewNote ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      reviewDate: input.reviewDate ?? null,
      status: "DRAFT",
      ruleVersion: 1,
      configuration: JSON.stringify(input.configuration),
      createdById: actor.id,
    },
  });

  await writeAudit({ action: "COMPLIANCE_RULE_CREATED", adminId: actor.id, meta: { ruleId: rule.id, ruleCode: rule.ruleCode } });
  return rule;
}

// Editing a DRAFT rule is not gated (plan/catalog comment) — only DRAFT or
// UNDER_REVIEW rules may still be edited; an APPROVED/ACTIVE rule must be
// superseded by a new version instead (never mutated after approval, mirrors
// VerificationPolicy's never-overwrite-in-place convention).
export async function updateDraftRule(ruleId: string, patch: Partial<Omit<CreateRuleInput, "jurisdictionId">>, actor: SessionAdmin) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status !== "DRAFT" && existing.status !== "UNDER_REVIEW") {
    throw new Error(`Cannot edit a rule in status ${existing.status} — supersede it with a new version instead`);
  }

  const rule = await prisma.complianceRule.update({
    where: { id: ruleId },
    data: {
      ...(patch.subject !== undefined && { subject: patch.subject }),
      ...(patch.requirementType !== undefined && { requirementType: patch.requirementType }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.sourceType !== undefined && { sourceType: patch.sourceType }),
      ...(patch.sourceTitle !== undefined && { sourceTitle: patch.sourceTitle }),
      ...(patch.sourceAuthority !== undefined && { sourceAuthority: patch.sourceAuthority }),
      ...(patch.sourceReference !== undefined && { sourceReference: patch.sourceReference }),
      ...(patch.sourceUrl !== undefined && { sourceUrl: patch.sourceUrl }),
      ...(patch.sourcePublicationDate !== undefined && { sourcePublicationDate: patch.sourcePublicationDate }),
      ...(patch.internalReviewNote !== undefined && { internalReviewNote: patch.internalReviewNote }),
      ...(patch.effectiveFrom !== undefined && { effectiveFrom: patch.effectiveFrom }),
      ...(patch.effectiveTo !== undefined && { effectiveTo: patch.effectiveTo }),
      ...(patch.reviewDate !== undefined && { reviewDate: patch.reviewDate }),
      ...(patch.configuration !== undefined && { configuration: JSON.stringify(patch.configuration) }),
    },
  });

  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: rule.status, edited: true } });
  return rule;
}

export async function submitRuleForReview(ruleId: string, actor: SessionAdmin) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status !== "DRAFT") throw new Error(`Only a DRAFT rule may be submitted for review (current status: ${existing.status})`);

  const rule = await prisma.complianceRule.update({ where: { id: ruleId }, data: { status: "UNDER_REVIEW" } });
  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: "UNDER_REVIEW" } });
  await createTask({ taskType: "COMPLIANCE_REVIEW", resourceType: "CASE", resourceId: ruleId, createdById: actor.id });
  return rule;
}

export interface ApproveRuleResult {
  requiresApproval: boolean;
  rule?: Awaited<ReturnType<typeof prisma.complianceRule.findUniqueOrThrow>>;
  approvalCode?: string;
  status?: string;
}

// The STEP 19 maker-checker step (catalog: COMPLIANCE_RULE_APPROVAL) — moves
// UNDER_REVIEW -> APPROVED. Deliberately does NOT also set ACTIVE: a rule can
// be legally approved ahead of its effectiveFrom date without silently going
// live (plan decision 3).
export async function approveRule(ruleId: string, actor: SessionAdmin, reason: string): Promise<ApproveRuleResult> {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status !== "UNDER_REVIEW") throw new Error(`Only an UNDER_REVIEW rule may be approved (current status: ${existing.status})`);

  const gate = await enforceApprovalGate({
    actionType: "COMPLIANCE_RULE_APPROVAL",
    sourceType: "CASE",
    sourceId: ruleId,
    actor,
    reason,
    currentStatePayload: { status: existing.status },
    requestedPayload: { status: "APPROVED" },
  });

  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
    return { requiresApproval: true, status: gate.status, approvalCode: gate.approvalCode };
  }

  const rule = await prisma.complianceRule.update({
    where: { id: ruleId },
    data: { status: "APPROVED", approvedById: actor.id, approvalDate: new Date() },
  });

  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);

  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: "APPROVED" } });
  return { requiresApproval: false, rule };
}

// Lighter follow-up step (plan decision 3) — flips APPROVED -> ACTIVE. Still
// audited and permission-gated by the route, but not a second full approval
// cycle (the legal decision was already made in approveRule()).
export async function activateRule(ruleId: string, actor: SessionAdmin) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status !== "APPROVED") throw new Error(`Only an APPROVED rule may be activated (current status: ${existing.status})`);

  const rule = await prisma.complianceRule.update({ where: { id: ruleId }, data: { status: "ACTIVE" } });
  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: "ACTIVE" } });

  // Never blocks activation (the legal decision already happened in
  // approveRule()) — this only flags for a human to decide which rule should
  // actually govern when two ACTIVE rules could both apply to the same
  // jurisdiction+requirementType with overlapping effective windows. The
  // rule engine itself already has a deterministic tiebreak (highest
  // ruleVersion wins), so this is a heads-up, not a correctness gap.
  const now = new Date();
  const overlapping = await prisma.complianceRule.findMany({
    where: {
      id: { not: rule.id },
      jurisdictionId: rule.jurisdictionId,
      requirementType: rule.requirementType,
      status: "ACTIVE",
      effectiveFrom: { lte: rule.effectiveTo ?? new Date(8640000000000000) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: rule.effectiveFrom } }],
    },
  });
  if (overlapping.length > 0) {
    const day = now.toISOString().slice(0, 10);
    await createFromEvent({
      eventName: "COMPLIANCE_POLICY_CONFLICT",
      dedupKey: `POLICY_CONFLICT:${rule.jurisdictionId}:${rule.requirementType}:${day}`,
      resourceType: "CASE",
      resourceId: rule.id,
      taskType: "COMPLIANCE_REVIEW",
      title: "Compliance policy conflict — multiple ACTIVE rules overlap",
      description: `Rule ${rule.ruleCode} conflicts with ${overlapping.map((r) => r.ruleCode).join(", ")} for the same jurisdiction/requirementType.`,
    });
    await notifyAdmins({
      type: "COMPLIANCE_POLICY_CONFLICT",
      data: { templateVars: { ruleCode: rule.ruleCode } },
      roles: ["COMPLIANCE_MANAGER"],
    });
  }

  return rule;
}

export async function suspendRule(ruleId: string, actor: SessionAdmin, reason: string) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status !== "ACTIVE") throw new Error(`Only an ACTIVE rule may be suspended (current status: ${existing.status})`);

  const rule = await prisma.complianceRule.update({ where: { id: ruleId }, data: { status: "SUSPENDED" } });
  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: "SUSPENDED", reason } });
  return rule;
}

export async function retireRule(ruleId: string, actor: SessionAdmin, reason: string) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (existing.status === "RETIRED") throw new Error("Rule is already retired");

  const rule = await prisma.complianceRule.update({ where: { id: ruleId }, data: { status: "RETIRED" } });
  await writeAudit({ action: "COMPLIANCE_RULE_STATUS_CHANGED", adminId: actor.id, meta: { ruleId, status: "RETIRED", reason } });
  return rule;
}

// Creates a new DRAFT version of an existing rule (never mutates the
// original once APPROVED/ACTIVE) — the versioning half of the never-
// overwrite-in-place convention. The prior rule's own lifecycle (e.g.
// remaining ACTIVE until the new version clears review) is left untouched;
// an admin retires/suspends it explicitly once the replacement is ACTIVE.
export async function supersedeRule(ruleId: string, patch: Partial<Omit<CreateRuleInput, "jurisdictionId">>, actor: SessionAdmin) {
  const existing = await prisma.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });

  const rule = await prisma.complianceRule.create({
    data: {
      ruleCode: await nextSequenceCode("CRULE"),
      jurisdictionId: existing.jurisdictionId,
      subject: patch.subject ?? existing.subject,
      requirementType: patch.requirementType ?? existing.requirementType,
      description: patch.description ?? existing.description,
      sourceType: patch.sourceType ?? existing.sourceType,
      sourceTitle: patch.sourceTitle ?? existing.sourceTitle,
      sourceAuthority: patch.sourceAuthority ?? existing.sourceAuthority,
      sourceReference: patch.sourceReference ?? existing.sourceReference,
      sourceUrl: patch.sourceUrl ?? existing.sourceUrl,
      sourcePublicationDate: patch.sourcePublicationDate ?? existing.sourcePublicationDate,
      internalReviewNote: patch.internalReviewNote ?? existing.internalReviewNote,
      effectiveFrom: patch.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: patch.effectiveTo ?? existing.effectiveTo,
      reviewDate: patch.reviewDate ?? existing.reviewDate,
      status: "DRAFT",
      ruleVersion: existing.ruleVersion + 1,
      configuration: patch.configuration !== undefined ? JSON.stringify(patch.configuration) : existing.configuration,
      createdById: actor.id,
    },
  });

  await writeAudit({ action: "COMPLIANCE_RULE_CREATED", adminId: actor.id, meta: { ruleId: rule.id, ruleCode: rule.ruleCode, supersedes: ruleId } });
  return rule;
}

export async function listRules(filter?: { jurisdictionId?: string; status?: string; requirementType?: string }) {
  return prisma.complianceRule.findMany({
    where: {
      ...(filter?.jurisdictionId && { jurisdictionId: filter.jurisdictionId }),
      ...(filter?.status && { status: filter.status as never }),
      ...(filter?.requirementType && { requirementType: filter.requirementType }),
    },
    orderBy: [{ jurisdictionId: "asc" }, { requirementType: "asc" }, { ruleVersion: "desc" }],
  });
}

export async function getRule(ruleId: string) {
  return prisma.complianceRule.findUnique({ where: { id: ruleId }, include: { jurisdiction: true } });
}

// Due-list for the admin "Reviews" surface (plan milestone 6) — rules whose
// reviewDate has passed and are still ACTIVE, i.e. genuinely due for a human
// look, not a calendar-grid UI (plan decision 14, explicitly deferred).
export async function listRulesDueForReview(asOf: Date = new Date()) {
  return prisma.complianceRule.findMany({
    where: { status: "ACTIVE", reviewDate: { lte: asOf } },
    orderBy: { reviewDate: "asc" },
  });
}
