import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import { redactPayload } from "@/lib/security/redact";
import { getRiskCaseForActor, ACTIVE_CASE_STATUSES } from "@/lib/risk/case-service";
import type { SessionAdmin } from "@/lib/route-guard";
import type { RiskEvidence, RiskEvidenceType } from "@prisma/client";

// RiskEvidenceService. Evidence is append-only and integrity-protected: the
// stored contentHash covers source + summary + occurredAt + canonical payload,
// so any later edit is detectable. There is intentionally NO update or delete
// function here — evidence leaves the system only through the retention
// process, which must respect open cases and legal holds
// (see evidenceDeletionBlockers).

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function computeEvidenceHash(parts: { source: string; summary: string; occurredAt: Date; payload: string | null }): string {
  return createHash("sha256").update(canonicalJson({ source: parts.source, summary: parts.summary, occurredAt: parts.occurredAt.toISOString(), payload: parts.payload })).digest("hex");
}

export async function addEvidence(params: {
  riskCaseId: string;
  actor: SessionAdmin;
  evidenceType: RiskEvidenceType;
  source: string;
  summary: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}): Promise<RiskEvidence> {
  const riskCase = await getRiskCaseForActor(params.riskCaseId, params.actor);
  if (!ACTIVE_CASE_STATUSES.includes(riskCase.status)) throw new HttpError(409, "Evidence can only be added to an open case.");
  const summary = params.summary.trim();
  if (summary.length < 3) throw new HttpError(422, "An evidence summary is required.");

  const occurredAt = params.occurredAt ?? new Date();
  const payload = params.payload ? canonicalJson(redactPayload(params.payload)) : null;
  const evidence = await prisma.riskEvidence.create({
    data: {
      riskCaseId: riskCase.id,
      evidenceType: params.evidenceType,
      source: params.source.slice(0, 80),
      summary: summary.slice(0, 1000),
      payload,
      contentHash: computeEvidenceHash({ source: params.source.slice(0, 80), summary: summary.slice(0, 1000), occurredAt, payload }),
      createdById: params.actor.id,
      occurredAt,
    },
  });
  await prisma.riskCaseEvent.create({ data: { riskCaseId: riskCase.id, eventType: "EVIDENCE_ADDED", actorAdminId: params.actor.id, summary: `Evidence added (${params.evidenceType}).`, payload: JSON.stringify({ evidenceId: evidence.id }) } });
  await writeAudit({ action: "RISK_EVIDENCE_ADDED", adminId: params.actor.id, targetProfileId: riskCase.subjectProfileId, meta: { riskCaseId: riskCase.id, evidenceId: evidence.id, evidenceType: params.evidenceType } });
  return evidence;
}

export function verifyEvidenceRecord(e: Pick<RiskEvidence, "source" | "summary" | "occurredAt" | "payload" | "contentHash">): boolean {
  return computeEvidenceHash({ source: e.source, summary: e.summary, occurredAt: e.occurredAt, payload: e.payload }) === e.contentHash;
}

// Reading evidence is itself a sensitive access: authorised by case visibility,
// logged against the subject profile, and audited.
export async function listEvidence(riskCaseId: string, actor: SessionAdmin) {
  const riskCase = await getRiskCaseForActor(riskCaseId, actor);
  const rows = await prisma.riskEvidence.findMany({ where: { riskCaseId: riskCase.id }, orderBy: { occurredAt: "asc" } });
  await logPrivacyAccess({ actorAdminId: actor.id, action: "RISK_EVIDENCE_VIEWED", field: "riskEvidence", targetProfileId: riskCase.subjectProfileId, reason: `Risk case ${riskCase.riskCode}`, purpose: "FRAUD_PREVENTION" });
  await writeAudit({ action: "RISK_EVIDENCE_VIEWED", adminId: actor.id, targetProfileId: riskCase.subjectProfileId, meta: { riskCaseId: riskCase.id, count: rows.length } });
  return rows.map((r) => ({ ...r, integrityOk: verifyEvidenceRecord(r) }));
}

// Retention hook: why evidence may NOT be deleted right now. Empty = eligible
// (the retention policy still has to say so — nothing here deletes anything).
export async function evidenceDeletionBlockers(evidenceId: string): Promise<string[]> {
  const evidence = await prisma.riskEvidence.findUnique({ where: { id: evidenceId }, include: { riskCase: true } });
  if (!evidence) return ["Evidence not found."];
  const blockers: string[] = [];
  if (evidence.riskCase && ACTIVE_CASE_STATUSES.includes(evidence.riskCase.status)) blockers.push("The risk case is still open.");
  const profileId = evidence.riskCase?.subjectProfileId;
  if (profileId) {
    const hold = await prisma.dataHold.findFirst({ where: { active: true, profileId }, select: { id: true } });
    if (hold) blockers.push("An active legal hold covers the subject profile.");
  }
  return blockers;
}
