import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/observability/logger";

// Spec §29/§53/§67 — AI data retention and privacy integration.
//  • Every stored AiResult has an expiry (AiConfig.retentionDays) and is purged
//    here, from the existing daily retention sweep.
//  • When a member's account is deleted/anonymised, every AI result that
//    referenced them is deleted and their id is removed from AI request
//    metadata (which otherwise holds no member data).
//  • AI request/safety METADATA is kept for an operational window. That number
//    is an operational default, NOT a claimed legal retention period; it is
//    meant to be reviewed with the Step 13 retention policies and counsel.

export const METADATA_RETENTION_DAYS = 180;

export async function purgeExpiredAiResults(now: Date = new Date()): Promise<{ results: number; requests: number; safetyEvents: number }> {
  const results = await prisma.aiResult.deleteMany({ where: { expiresAt: { lte: now } } });
  const cutoff = new Date(now.getTime() - METADATA_RETENTION_DAYS * 86_400_000);
  const requests = await prisma.aiRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const safetyEvents = await prisma.aiSafetyEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { results: results.count, requests: requests.count, safetyEvents: safetyEvents.count };
}

export async function eraseAiDataForProfile(profileId: string): Promise<{ results: number; requests: number }> {
  const results = await prisma.aiResult.deleteMany({ where: { profileIds: { has: profileId } } });
  const requests = await prisma.$executeRaw(
    Prisma.sql`UPDATE "AiRequest" SET "profileIds" = array_remove("profileIds", ${profileId}) WHERE ${profileId} = ANY("profileIds")`
  );
  return { results: results.count, requests: Number(requests) };
}

// Called from the retention sweep / deletion executor. It must never break them:
// if the AI tables do not exist yet, or anything fails, it logs and returns.
export async function safeSweepAiData(): Promise<void> {
  try {
    await purgeExpiredAiResults();
  } catch (err) {
    logger.warn("ai_retention_sweep_failed", { error: String((err as Error).message).slice(0, 120) });
  }
}

export async function safeEraseAiDataForProfile(profileId: string): Promise<void> {
  try {
    await eraseAiDataForProfile(profileId);
  } catch (err) {
    logger.warn("ai_erase_failed", { error: String((err as Error).message).slice(0, 120) });
  }
}
