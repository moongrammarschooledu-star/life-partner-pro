import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { deliverLog, retryDeadLetter } from "@/lib/communications/send-service";
import { writeAudit } from "@/lib/audit";

// Controlled, capped retry (spec §16) — never automatic/unbounded.
export async function POST(_req: Request, { params }: { params: Promise<{ logId: string }> }) {
  try {
    const admin = await requireAdmin("communication:send");
    const { logId } = await params;

    const log = await prisma.communicationLog.findUnique({ where: { id: logId }, include: { profile: { include: { contact: true } } } });
    if (!log) throw new ApiError(404, "Not found");
    if (log.deliveryStatus !== "FAILED" && !(log.deadLetteredAt && ["REJECTED", "BOUNCED", "EXPIRED"].includes(log.deliveryStatus))) throw new ApiError(400, "Only a failed delivery can be retried");
    if (log.messageBody === null || log.bodyRedactedAt) throw new ApiError(409, "The message content is no longer retained, so it cannot be resent.");

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const limit = settings?.notificationRetryLimit ?? 3;
    if (log.retryCount >= limit) throw new ApiError(400, "Retry limit reached for this message");

    const contact = log.profile.contact;
    const destination = log.channel === "EMAIL" ? contact?.email : log.channel === "WHATSAPP" ? contact?.whatsappNumber : contact?.mobileNumber;
    if (!destination) throw new ApiError(400, "No destination available to retry");

    // The message is re-queued and delivered through the same policy checks and provider chain as a first attempt (the destination is
    // re-resolved server-side at send time; the address is never taken from here).
    if (log.deadLetteredAt) {
      await retryDeadLetter(logId, { id: admin.id, permissions: admin.permissions });
    } else {
      await prisma.communicationLog.update({ where: { id: logId }, data: { retryCount: { increment: 1 }, deliveryStatus: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lockedUntil: null } });
      await deliverLog(logId);
    }
    await writeAudit({ action: "NOTIFICATION_RETRY_TRIGGERED", adminId: admin.id, targetProfileId: log.profileId, meta: { logId } });

    const updated = await prisma.communicationLog.findUnique({ where: { id: logId } });
    return NextResponse.json({ deliveryStatus: updated?.deliveryStatus, retryCount: updated?.retryCount });
  } catch (error) {
    return handleApiError(error);
  }
}
