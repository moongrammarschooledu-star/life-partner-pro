import { prisma } from "@/lib/prisma";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import { encryptText } from "@/lib/communications/crypto";

// Communication retention (spec §39/§66), plugged into the existing STEP 13 retention policy for COMMUNICATION_RECORDS.
// Message CONTENT is what is sensitive, so retention REDACTS the content (body -> null, bodyRedactedAt set) and keeps the metadata
// row (channel, status, timestamps, template, provider) that analytics and audit still need. Nothing is redacted while:
//   - a legal / data hold covers the profile,
//   - the profile has an open support case or an active risk case (an investigation or dispute may need the wording),
//   - or no ACTIVE retention policy exists for the category (absent policy = keep; retention is never guessed).

export interface CommunicationRetentionResult {
  ran: boolean;
  redactedMessages: number;
  redactedThreadMessages: number;
  skippedHold: number;
  skippedOpenCase: number;
}

export async function retentionBlockers(profileId: string): Promise<string[]> {
  const blockers: string[] = [];
  if (await hasActiveHold({ profileId })) blockers.push("LEGAL_HOLD");
  const [openCase, openRisk] = await Promise.all([
    prisma.case.count({ where: { OR: [{ reporterProfileId: profileId }, { reportedProfileId: profileId }], status: { notIn: ["RESOLVED", "CLOSED"] } } }),
    prisma.riskCase.count({ where: { subjectProfileId: profileId, status: { in: ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED", "SUSPENDED"] } } }),
  ]);
  if (openCase > 0) blockers.push("OPEN_CASE");
  if (openRisk > 0) blockers.push("OPEN_RISK_CASE");
  return blockers;
}

export async function sweepCommunicationData(now: Date = new Date()): Promise<CommunicationRetentionResult> {
  const result: CommunicationRetentionResult = { ran: false, redactedMessages: 0, redactedThreadMessages: 0, skippedHold: 0, skippedOpenCase: 0 };
  const policy = await prisma.retentionPolicy.findUnique({ where: { category: "COMMUNICATION_RECORDS" } });
  if (!policy || !policy.isActive || policy.retentionDays <= 0) return result;
  result.ran = true;
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);

  const due = await prisma.communicationLog.findMany({ where: { createdAt: { lt: cutoff }, messageBody: { not: null }, bodyRedactedAt: null }, select: { id: true, profileId: true }, take: 500 });
  const decided = new Map<string, string[]>();
  const redactIds: string[] = [];
  for (const row of due) {
    if (!decided.has(row.profileId)) decided.set(row.profileId, await retentionBlockers(row.profileId));
    const blockers = decided.get(row.profileId) as string[];
    if (blockers.includes("LEGAL_HOLD")) result.skippedHold++;
    else if (blockers.length) result.skippedOpenCase++;
    else redactIds.push(row.id);
  }
  if (redactIds.length) {
    const r = await prisma.communicationLog.updateMany({ where: { id: { in: redactIds } }, data: { messageBody: null, bodyRedactedAt: now } });
    result.redactedMessages = r.count;
  }

  // Thread messages follow the same rule; the body column is required, so it is replaced by an encrypted placeholder.
  const threads = await prisma.communicationThread.findMany({ where: { updatedAt: { lt: cutoff }, status: { in: ["CLOSED", "ARCHIVED"] } }, select: { id: true, profileId: true }, take: 200 });
  for (const t of threads) {
    if (t.profileId) {
      const blockers = decided.get(t.profileId) ?? (await retentionBlockers(t.profileId));
      decided.set(t.profileId, blockers);
      if (blockers.length) continue;
    }
    const r = await prisma.communicationThreadMessage.updateMany({ where: { threadId: t.id }, data: { body: encryptText("[content removed by retention policy]"), bodyEncrypted: true } });
    result.redactedThreadMessages += r.count;
  }

  await prisma.retentionActionLog.create({ data: { category: "COMMUNICATION_RECORDS", recordType: "CommunicationLog", recordId: "batch", action: policy.action, outcome: "APPLIED", detail: JSON.stringify({ redacted: result.redactedMessages, threadMessages: result.redactedThreadMessages, skippedHold: result.skippedHold, skippedOpenCase: result.skippedOpenCase }) } });
  return result;
}

// Never lets a retention problem break the daily tick.
export async function safeSweepCommunicationData(): Promise<CommunicationRetentionResult | null> {
  try {
    return await sweepCommunicationData();
  } catch (error) {
    console.error("[communications] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
