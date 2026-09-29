import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Document expiry reminders and re-verification (spec §35/§36). Intervals are configurable in code
// (REMINDER_DAYS) — each fires at most once per document per interval via the WorkflowEvent dedup key,
// exactly like STEP 25's follow-up automation.

const REMINDER_DAYS = [30, 14, 7] as const;
const DAY = 86_400_000;

async function remind(documentId: string, profileId: string | null, days: number): Promise<boolean> {
  if (!profileId) return false;
  const { createFromEvent } = await import("@/lib/workflow/engine");
  const created = await createFromEvent({
    eventName: `DOCUMENT_EXPIRY_REMINDER_${days}`,
    dedupKey: `DOCUMENT_EXPIRY:${documentId}:${days}`,
    resourceType: "DOCUMENT",
    resourceId: documentId,
    taskType: "DOCUMENT_REQUEST_FOLLOWUP",
    title: `A document expires in ${days} day(s)`,
    description: `Document ${documentId} is expiring soon.`,
  });
  if (created) {
    const { sendNotification } = await import("@/lib/notifications/notification-service");
    await sendNotification({ profileId, type: "DOCUMENT_EXPIRING_SOON", data: { relatedProfileId: profileId } });
  }
  return !!created;
}

export interface ExpirationSweepResult {
  reminded: number;
  expired: number;
}

export async function sweepDocumentExpiration(now: Date = new Date()): Promise<ExpirationSweepResult> {
  const summary: ExpirationSweepResult = { reminded: 0, expired: 0 };

  // Upcoming reminders — one active window per configured interval.
  for (const days of REMINDER_DAYS) {
    const windowStart = new Date(now.getTime() + (days - 1) * DAY);
    const windowEnd = new Date(now.getTime() + days * DAY);
    const upcoming = await prisma.document.findMany({
      where: { expiresAt: { gte: windowStart, lt: windowEnd }, softDeletedAt: null, status: { notIn: ["ARCHIVED", "DELETED", "EXPIRED", "REJECTED"] } },
      select: { id: true, profileId: true },
      take: 300,
    });
    for (const doc of upcoming) if (await remind(doc.id, doc.profileId, days)) summary.reminded++;
  }

  // Past expiry — EXPIRED -> REVERIFICATION_REQUIRED -> task -> notification (spec §36).
  const expired = await prisma.document.findMany({
    where: { expiresAt: { lt: now }, softDeletedAt: null, status: { notIn: ["ARCHIVED", "DELETED", "EXPIRED", "REJECTED", "QUARANTINED"] } },
    select: { id: true, profileId: true },
    take: 300,
  });
  for (const doc of expired) {
    await prisma.document.update({ where: { id: doc.id }, data: { status: "EXPIRED", verificationStatus: "REVERIFICATION_REQUIRED" } });
    await prisma.documentVerificationEvent.create({ data: { documentId: doc.id, action: "MARK_REVERIFICATION_REQUIRED", reasonKey: "EXPIRED" } });
    await writeAudit({ action: "DOCUMENT_REVERIFICATION_REQUIRED", targetProfileId: doc.profileId ?? undefined, meta: { documentId: doc.id } });
    const { createFromEvent } = await import("@/lib/workflow/engine");
    await createFromEvent({
      eventName: "DOCUMENT_REVERIFICATION_TASK",
      dedupKey: `DOCUMENT_REVERIFICATION:${doc.id}`,
      resourceType: "DOCUMENT",
      resourceId: doc.id,
      taskType: "DOCUMENT_REVERIFICATION_TASK",
      title: "A document expired and needs re-upload",
      description: `Document ${doc.id} expired and needs re-verification.`,
    });
    if (doc.profileId) {
      const { sendNotification } = await import("@/lib/notifications/notification-service");
      await sendNotification({ profileId: doc.profileId, type: "DOCUMENT_REVERIFICATION_REQUIRED", data: { relatedProfileId: doc.profileId } });
    }
    summary.expired++;
  }
  return summary;
}
