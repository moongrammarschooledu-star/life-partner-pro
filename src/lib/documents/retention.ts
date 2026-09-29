import { prisma } from "@/lib/prisma";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import { deleteDocumentBytes } from "@/lib/documents/storage";

// Document retention (spec §53), plugged into the existing STEP 13 retention policy for
// DOCUMENT_RECORDS. Redacts the CONTENT (deletes the blob, sets bodyRedactedAt) rather than the row —
// type, dates, verification status, audit and version history are all retained, mirroring exactly how
// STEP 25 redacts old communication bodies. Never touches a document that is:
//   - under an active legal hold (DataHold, recordType "Document"), or
//   - owned by a profile with an open support/risk case (an investigation or dispute may need it), or
//   - covered by no ACTIVE retention policy (absent policy = keep; retention is never guessed).

export interface DocumentRetentionResult {
  ran: boolean;
  redacted: number;
  skippedHold: number;
  skippedOpenCase: number;
}

async function retentionBlockers(profileId: string): Promise<string[]> {
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

export async function sweepDocumentRetention(now: Date = new Date()): Promise<DocumentRetentionResult> {
  const result: DocumentRetentionResult = { ran: false, redacted: 0, skippedHold: 0, skippedOpenCase: 0 };
  const policy = await prisma.retentionPolicy.findUnique({ where: { category: "DOCUMENT_RECORDS" } });
  if (!policy || !policy.isActive || policy.retentionDays <= 0) return result;
  result.ran = true;
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);

  // Never redact a document that is still expected to be relevant: only ones already terminal
  // (verified/rejected/expired/archived) and past their own expiry are eligible, on top of the age cutoff.
  const due = await prisma.document.findMany({
    where: { createdAt: { lt: cutoff }, bodyRedactedAt: null, softDeletedAt: null, status: { in: ["VERIFIED", "REJECTED", "EXPIRED", "ARCHIVED"] }, OR: [{ expiresAt: null }, { expiresAt: { lt: now } }] },
    select: { id: true, profileId: true, secureStorageReference: true },
    take: 300,
  });

  const decided = new Map<string, string[]>();
  for (const doc of due) {
    const blockers = doc.profileId ? (decided.get(doc.profileId) ?? (await retentionBlockers(doc.profileId))) : [];
    if (doc.profileId) decided.set(doc.profileId, blockers);
    if (blockers.includes("LEGAL_HOLD")) {
      result.skippedHold++;
      continue;
    }
    if (blockers.length) {
      result.skippedOpenCase++;
      continue;
    }
    await deleteDocumentBytes(doc.secureStorageReference);
    await prisma.document.update({ where: { id: doc.id }, data: { bodyRedactedAt: now } });
    result.redacted++;
  }

  await prisma.retentionActionLog.create({
    data: { category: "DOCUMENT_RECORDS", recordType: "Document", recordId: "batch", action: policy.action, outcome: "APPLIED", detail: JSON.stringify({ redacted: result.redacted, skippedHold: result.skippedHold, skippedOpenCase: result.skippedOpenCase }) },
  });
  return result;
}

export async function safeSweepDocumentRetention(): Promise<DocumentRetentionResult | null> {
  try {
    return await sweepDocumentRetention();
  } catch (error) {
    console.error("[documents] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
