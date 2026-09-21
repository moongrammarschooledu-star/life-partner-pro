import type { AiFeature, AiProviderKind, AiRequestStatus, AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import type { SafetyEvent } from "@/lib/ai/safety";
import type { AiPayload } from "@/lib/ai/types";

// Spec §28 — audit and request records. Only metadata is stored: who, which
// feature, which provider/model/prompt version, outcome, correlation id. No
// prompt text, no result text (beyond the policy-controlled AiResult), no PII.

export const AUDIT_FOR: Record<AiFeature, AuditAction> = {
  PROFILE_SUMMARY: "AI_PROFILE_SUMMARY_GENERATED",
  MATCH_EXPLANATION: "AI_MATCH_EXPLANATION_GENERATED",
  COMPARE: "AI_COMPARISON_GENERATED",
  PROPOSAL_ASSISTANT: "AI_PROPOSAL_ASSISTANCE_USED",
  COMMUNICATION_ASSISTANT: "AI_MESSAGE_GENERATED",
  FOLLOWUP_ASSISTANT: "AI_FOLLOWUP_DRAFTED",
  COPILOT: "AI_COPILOT_USED",
  REPORT_ASSISTANT: "AI_REPORT_SUMMARY_GENERATED",
  DATA_QUALITY: "AI_DATA_QUALITY_CHECKED",
  PROFILE_IMPROVEMENT: "AI_DATA_QUALITY_CHECKED",
};

export interface RequestBase {
  actorAdminId: string;
  actorRole: string;
  feature: AiFeature;
  provider: AiProviderKind;
  model: string;
  promptVersion: string;
  aiVersion: string;
  appVersion?: string | null;
  matchAlgorithmVersion?: string | null;
  correlationId?: string | null;
  profileIds: string[];
}

export async function recordRequest(
  base: RequestBase,
  extra: {
    status: AiRequestStatus;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
    costIsEstimate?: boolean;
    consentOutcome?: string;
    errorCode?: string;
    fromCache?: boolean;
  }
): Promise<string> {
  const row = await prisma.aiRequest.create({
    data: {
      ...base,
      status: extra.status,
      latencyMs: extra.latencyMs ?? null,
      inputTokens: extra.inputTokens ?? null,
      outputTokens: extra.outputTokens ?? null,
      estimatedCostUsd: extra.estimatedCostUsd ?? null,
      costIsEstimate: extra.costIsEstimate ?? false,
      consentOutcome: extra.consentOutcome ?? null,
      errorCode: extra.errorCode ?? null,
      fromCache: extra.fromCache ?? false,
    },
    select: { id: true },
  });
  return row.id;
}

export async function recordSafetyEvents(params: { requestId?: string; actorAdminId: string; feature: AiFeature; events: SafetyEvent[] }): Promise<void> {
  if (params.events.length === 0) return;
  const unique = new Map(params.events.map((e) => [`${e.rule}:${e.action}`, e]));
  await prisma.aiSafetyEvent.createMany({
    data: [...unique.values()].map((e) => ({
      requestId: params.requestId ?? null,
      actorAdminId: params.actorAdminId,
      feature: params.feature,
      rule: e.rule,
      action: e.action === "BLOCKED" ? "BLOCKED" : "REWRITTEN",
    })),
  });
}

export async function auditAi(action: AuditAction, adminId: string, meta: Record<string, unknown>, targetProfileId?: string | null): Promise<void> {
  await writeAudit({ action, adminId, targetProfileId: targetProfileId ?? null, meta });
}

export async function logAiAccess(adminId: string, feature: AiFeature, profileIds: string[]): Promise<void> {
  for (const id of profileIds) {
    await logPrivacyAccess({ actorAdminId: adminId, action: `AI_PROCESSING:${feature}`, field: "partnerPreferences", targetProfileId: id, reason: "AI-assisted analysis by an authorised admin" });
  }
}

export interface StoredResult {
  requestId: string;
  feature: AiFeature;
  profileIds: string[];
  structured: Record<string, unknown> | null;
  expiresAt: Date;
  cacheKey: string | null;
}

export async function storeResult(r: StoredResult & { storageMode: "SUMMARY_ONLY" | "FULL_RESULT" | "LIMITED_PERIOD" }): Promise<void> {
  await prisma.aiResult.create({
    data: {
      requestId: r.requestId,
      feature: r.feature,
      profileIds: r.profileIds,
      structured: (r.structured ?? undefined) as never,
      storageMode: r.storageMode,
      expiresAt: r.expiresAt,
      cacheKey: r.cacheKey,
    },
  });
}

export async function readCachedPayload(cacheKey: string, ttlMinutes: number, now: Date = new Date()): Promise<AiPayload | null> {
  const row = await prisma.aiResult.findFirst({
    where: { cacheKey, expiresAt: { gt: now }, createdAt: { gt: new Date(now.getTime() - ttlMinutes * 60_000) } },
    orderBy: { createdAt: "desc" },
    select: { structured: true },
  });
  return (row?.structured as unknown as AiPayload | null) ?? null;
}
