import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifySecurityFlagRaised } from "@/lib/notifications/events";
import { getEffectiveFactor } from "@/lib/risk/config";
import type { FalsePositiveReason, RiskConfidence, RiskSignalCategory, SecurityFlag, SecurityFlagSeverity, SecurityFlagStatus, SecurityFlagType } from "@prisma/client";

// RiskSignalService. A signal is one piece of unverified evidence — never an
// assessment, never a conclusion about a person. Creation is idempotent by
// construction (unique dedupKey + "an open signal of this type already exists"),
// replacing the previous racy check-then-insert.

export const OPEN_SIGNAL_STATUSES: SecurityFlagStatus[] = ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "ESCALATED"];

// A signal type that a known, reviewed relationship legitimately explains.
const RELATIONSHIP_EXPLAINABLE: SecurityFlagType[] = [
  "CONTACT_REUSE_SIGNAL",
  "RAPID_REGISTRATION_SIGNAL",
  "SHARED_DEVICE_SIGNAL",
  "UNUSUAL_NETWORK_ACTIVITY",
  "DUPLICATE_PROFILE_SUSPECTED",
  "MULTIPLE_REGISTRATIONS",
];

export function dayBucket(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function buildDedupKey(parts: { ruleKey: string; profileId: string; relatedProfileId?: string | null; bucket: string }): string {
  return `${parts.ruleKey}:${parts.profileId}:${parts.relatedProfileId ?? "-"}:${parts.bucket}`;
}

// Profiles whose relationship to `profileId` is already explained by a human
// review (authorized family account, family relation, or "not a duplicate").
// Used to suppress the exact false positives the spec calls out: a spouse
// sharing a phone, a family sharing a device, a cleared duplicate pair.
export async function suppressedRelatedProfiles(profileId: string, otherIds: string[]): Promise<Set<string>> {
  if (otherIds.length === 0) return new Set();
  const rows = await prisma.accountRelationship.findMany({
    where: {
      status: "ACTIVE",
      relationshipType: { in: ["AUTHORIZED_FAMILY_ACCOUNT", "FAMILY_RELATED", "UNKNOWN_RELATIONSHIP"] },
      OR: [
        { profileId, relatedProfileId: { in: otherIds } },
        { relatedProfileId: profileId, profileId: { in: otherIds } },
      ],
    },
    select: { profileId: true, relatedProfileId: true },
  });
  const out = new Set<string>();
  for (const r of rows) out.add(r.profileId === profileId ? r.relatedProfileId : r.profileId);
  return out;
}

export interface CreateRiskSignalParams {
  profileId: string;
  flagType: SecurityFlagType;
  ruleKey: string;
  ruleVersion?: number;
  description: string;
  severity?: SecurityFlagSeverity;
  confidence?: RiskConfidence;
  category?: RiskSignalCategory;
  source?: string;
  evidenceRef?: string | null;
  relatedProfileId?: string | null;
  bucket?: string;
  reviewRequired?: boolean;
  jurisdictionScope?: string;
  notifyAsDuplicate?: boolean;
}

export type CreateRiskSignalResult =
  | { created: true; flag: SecurityFlag }
  | { created: false; reason: "OPEN_EXISTS" | "DUPLICATE_KEY" | "FACTOR_DISABLED" | "RELATIONSHIP_EXPLAINED" };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function createRiskSignal(params: CreateRiskSignalParams): Promise<CreateRiskSignalResult> {
  const factor = await getEffectiveFactor(params.flagType, params.jurisdictionScope);
  if (!factor.enabled) return { created: false, reason: "FACTOR_DISABLED" };

  if (params.relatedProfileId && RELATIONSHIP_EXPLAINABLE.includes(params.flagType)) {
    const explained = await suppressedRelatedProfiles(params.profileId, [params.relatedProfileId]);
    if (explained.has(params.relatedProfileId)) return { created: false, reason: "RELATIONSHIP_EXPLAINED" };
  }

  // An ongoing condition keeps ONE open signal; it does not pile up a new one per scan.
  const existing = await prisma.securityFlag.findFirst({
    where: { profileId: params.profileId, flagType: params.flagType, relatedProfileId: params.relatedProfileId ?? null, status: { in: OPEN_SIGNAL_STATUSES } },
    select: { id: true },
  });
  if (existing) return { created: false, reason: "OPEN_EXISTS" };

  const dedupKey = buildDedupKey({ ruleKey: params.ruleKey, profileId: params.profileId, relatedProfileId: params.relatedProfileId, bucket: params.bucket ?? dayBucket() });
  const duplicate = await prisma.securityFlag.findUnique({ where: { dedupKey }, select: { id: true } });
  if (duplicate) return { created: false, reason: "DUPLICATE_KEY" };

  let flag: SecurityFlag;
  try {
    flag = await prisma.securityFlag.create({
      data: {
        profileId: params.profileId,
        flagType: params.flagType,
        severity: params.severity ?? factor.severity,
        description: params.description,
        relatedProfileId: params.relatedProfileId ?? null,
        signalCode: await nextSequenceCode("SIGNAL"),
        category: params.category ?? factor.category,
        confidence: params.confidence ?? factor.confidence,
        source: params.source ?? "rule-engine",
        evidenceRef: params.evidenceRef ?? null,
        reviewRequired: params.reviewRequired ?? true,
        ruleVersion: params.ruleVersion ?? factor.version,
        dedupKey,
      },
    });
  } catch (error) {
    // Two concurrent detections: the unique dedupKey makes exactly one win.
    if (isUniqueViolation(error)) return { created: false, reason: "DUPLICATE_KEY" };
    throw error;
  }

  await writeAudit({ action: "RISK_SIGNAL_DETECTED", targetProfileId: params.profileId, meta: { flagType: params.flagType, flagId: flag.id, signalCode: flag.signalCode, ruleKey: params.ruleKey } });
  await notifySecurityFlagRaised(params.profileId, params.notifyAsDuplicate === true, flag.id);
  await createFromEvent({
    eventName: "RISK_SIGNAL_DETECTED",
    dedupKey: `RISK_SIGNAL_REVIEW:${flag.id}`,
    resourceType: "PROFILE",
    resourceId: params.profileId,
    taskType: "RISK_SIGNAL_REVIEW",
    title: `Risk signal: ${params.flagType}`,
    description: params.description,
  });

  return { created: true, flag };
}

const RESOLUTION_STATUSES: SecurityFlagStatus[] = ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "DISMISSED", "FALSE_POSITIVE", "CONFIRMED", "ESCALATED", "ARCHIVED"];

// Only a human moves a signal to a decision state. `adminId` is mandatory, so
// no automated path can mark a signal CONFIRMED or FALSE_POSITIVE.
export async function resolveRiskSignal(params: {
  flagId: string;
  status: SecurityFlagStatus;
  adminId: string;
  resolution?: string;
  falsePositiveReason?: FalsePositiveReason;
}) {
  if (!RESOLUTION_STATUSES.includes(params.status)) throw new HttpError(422, "Invalid signal status.");
  if (["RESOLVED", "DISMISSED", "FALSE_POSITIVE", "CONFIRMED"].includes(params.status) && !params.resolution?.trim()) {
    throw new HttpError(422, "A resolution note is required.");
  }
  if (params.status === "FALSE_POSITIVE" && !params.falsePositiveReason) {
    throw new HttpError(422, "A structured false-positive reason is required.");
  }
  const flag = await prisma.securityFlag.findUnique({ where: { id: params.flagId } });
  if (!flag) throw new HttpError(404, "Risk signal not found.");
  if (flag.status === "ARCHIVED") throw new HttpError(409, "An archived signal cannot be changed.");

  const terminal = ["RESOLVED", "DISMISSED", "FALSE_POSITIVE", "CONFIRMED", "ARCHIVED"].includes(params.status);
  const updated = await prisma.securityFlag.update({
    where: { id: params.flagId },
    data: {
      status: params.status,
      resolution: params.resolution?.trim() ?? flag.resolution,
      falsePositiveReason: params.status === "FALSE_POSITIVE" ? params.falsePositiveReason : flag.falsePositiveReason,
      resolvedById: terminal ? params.adminId : flag.resolvedById,
      resolvedAt: terminal ? new Date() : flag.resolvedAt,
    },
  });
  await writeAudit({
    action: terminal ? "RISK_SIGNAL_RESOLVED" : "RISK_SIGNAL_REVIEWED",
    adminId: params.adminId,
    targetProfileId: flag.profileId,
    meta: { flagId: flag.id, from: flag.status, to: params.status, falsePositiveReason: params.falsePositiveReason },
  });
  return updated;
}

export async function getOpenSignals(profileId: string) {
  return prisma.securityFlag.findMany({ where: { profileId, status: { in: OPEN_SIGNAL_STATUSES } }, orderBy: { createdAt: "desc" } });
}
