import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { createTask } from "@/lib/workflow/engine";
import type { SessionAdmin } from "@/lib/route-guard";
import type { AuthorityRequestType } from "@prisma/client";

// Spec §29/§30/§31 (plan decision 9) — verificationStatus and
// legalReviewStatus are tracked separately, and BOTH must independently clear
// before disclosure is even attempted, so a request can never be disclosed
// against based solely on an informal/unverified request. No "emergency
// bypass" path exists (spec §30) — a genuine emergency is still just a
// request row with requestType: OTHER_AUTHORITY going through this same gate.

export interface CreateAuthorityRequestInput {
  requestType: AuthorityRequestType;
  authority: string;
  jurisdictionId?: string;
  requestReference?: string;
  scope: string;
  deadline?: Date;
}

export async function createAuthorityRequest(input: CreateAuthorityRequestInput, actor: SessionAdmin) {
  const request = await prisma.authorityRequest.create({
    data: {
      requestCode: await nextSequenceCode("AUTHREQ"),
      requestType: input.requestType,
      authority: input.authority,
      jurisdictionId: input.jurisdictionId ?? null,
      requestReference: input.requestReference ?? null,
      scope: input.scope,
      deadline: input.deadline ?? null,
      verificationStatus: "UNVERIFIED",
      legalReviewStatus: "PENDING",
      reviewerId: actor.id,
    },
  });

  await writeAudit({ action: "AUTHORITY_REQUEST_RECEIVED", adminId: actor.id, meta: { requestId: request.id, requestCode: request.requestCode, requestType: input.requestType } });
  await createTask({ taskType: "AUTHORITY_REQUEST_REVIEW", resourceType: "CASE", resourceId: request.id, priority: "HIGH", dueAt: input.deadline ?? null, createdById: actor.id });
  return request;
}

// Confirms the request genuinely came from the authority it claims to (e.g.
// a callback to a published contact, an official portal reference) — a
// distinct, auditable step, never inferred from the request's own claims.
export async function recordVerification(requestId: string, verified: boolean, actor: SessionAdmin, note: string) {
  const request = await prisma.authorityRequest.update({
    where: { id: requestId },
    data: { verificationStatus: verified ? "VERIFIED" : "REJECTED" },
  });

  await writeAudit({ action: "AUTHORITY_REQUEST_VERIFIED", adminId: actor.id, meta: { requestId, verified, note } });
  return request;
}

export async function recordLegalReview(requestId: string, status: "UNDER_REVIEW" | "APPROVED" | "REJECTED", actor: SessionAdmin, note: string) {
  const request = await prisma.authorityRequest.update({
    where: { id: requestId },
    data: { legalReviewStatus: status },
  });

  await writeAudit({ action: "COMPLIANCE_REVIEW_COMPLETED", adminId: actor.id, meta: { requestId, legalReviewStatus: status, note } });
  return request;
}

export interface DiscloseResult {
  requiresApproval: boolean;
  request?: Awaited<ReturnType<typeof prisma.authorityRequest.findUniqueOrThrow>>;
  approvalCode?: string;
  status?: string;
}

// The actual disclosure — gated through the STEP 19 maker-checker system
// (catalog: AUTHORITY_DISCLOSURE_APPROVAL, LEVEL_4/SUPER_ADMIN-only). Refuses
// outright, before even reaching the gate, unless BOTH independent checks
// have already cleared — never a single point of failure.
export async function discloseToAuthority(
  requestId: string,
  approvedDisclosureScope: string,
  disclosedData: unknown,
  actor: SessionAdmin,
  reason: string
): Promise<DiscloseResult> {
  const existing = await prisma.authorityRequest.findUniqueOrThrow({ where: { id: requestId } });

  if (existing.verificationStatus !== "VERIFIED") {
    throw new Error("Cannot disclose against an unverified authority request");
  }
  if (existing.legalReviewStatus !== "APPROVED") {
    throw new Error("Cannot disclose before legal review has approved this request");
  }

  const gate = await enforceApprovalGate({
    actionType: "AUTHORITY_DISCLOSURE_APPROVAL",
    sourceType: "CASE",
    sourceId: requestId,
    actor,
    reason,
    currentStatePayload: { disclosedData: null },
    requestedPayload: { approvedDisclosureScope },
  });

  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
    return { requiresApproval: true, status: gate.status, approvalCode: gate.approvalCode };
  }

  const request = await prisma.authorityRequest.update({
    where: { id: requestId },
    data: {
      approvedDisclosureScope,
      disclosedData: JSON.stringify(disclosedData),
      disclosureDate: new Date(),
    },
  });

  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);

  await writeAudit({ action: "AUTHORITY_REQUEST_DISCLOSED", adminId: actor.id, meta: { requestId, approvedDisclosureScope } });
  return { requiresApproval: false, request };
}

export async function listAuthorityRequests(filter?: { legalReviewStatus?: string; verificationStatus?: string }) {
  return prisma.authorityRequest.findMany({
    where: {
      ...(filter?.legalReviewStatus && { legalReviewStatus: filter.legalReviewStatus }),
      ...(filter?.verificationStatus && { verificationStatus: filter.verificationStatus }),
    },
    orderBy: { receivedAt: "desc" },
  });
}

export async function getAuthorityRequest(requestId: string) {
  return prisma.authorityRequest.findUnique({ where: { id: requestId }, include: { jurisdiction: true } });
}

// Due-list for the admin Reviews surface — requests awaiting legal review,
// oldest/nearest-deadline first.
export async function listAuthorityRequestsAwaitingReview() {
  return prisma.authorityRequest.findMany({
    where: { legalReviewStatus: { in: ["PENDING", "UNDER_REVIEW"] } },
    orderBy: [{ deadline: "asc" }, { receivedAt: "asc" }],
  });
}
