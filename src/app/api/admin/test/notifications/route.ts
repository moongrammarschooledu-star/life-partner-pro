import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { NotificationChannel } from "@prisma/client";

const VALID_CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"];

// Spec §32 — Admin/Super Admin only. The "to" value must be typed in by the
// admin (their own email/phone, or a scratch value) — never auto-filled from
// a real applicant profile, so a test send can never accidentally reach one.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communication:send");
    const { channel, to, message } = await req.json();

    if (!VALID_CHANNELS.includes(channel)) throw new ApiError(400, "Invalid channel");
    if (!message?.trim()) throw new ApiError(400, "A message is required");
    if (channel !== "IN_APP" && !to?.trim()) throw new ApiError(400, "A destination is required for this channel");

    if (channel === "IN_APP") {
      await prisma.notification.create({
        data: {
          recipientAdminId: admin.id,
          type: "TEST_NOTIFICATION",
          title: "Test Notification",
          body: message.trim(),
        },
      });
    } else {
      // Needs a real profile FK for CommunicationLog — the admin's own test
      // sends aren't tied to any applicant, so no row is created; dispatch
      // straight to the provider and just report success/failure inline.
      try {
        const { emailProvider } = await import("@/lib/notifications/providers/email-provider");
        const { smsProvider } = await import("@/lib/notifications/providers/sms-provider");
        const { whatsappProvider } = await import("@/lib/notifications/providers/whatsapp-provider");
        const provider = channel === "EMAIL" ? emailProvider : channel === "SMS" ? smsProvider : whatsappProvider;
        await provider.send(to.trim(), `[TEST] ${message.trim()}`, channel === "EMAIL" ? "Life Partner Pro — Test Notification" : undefined);
      } catch (err) {
        throw new ApiError(502, err instanceof Error ? err.message : "Test send failed");
      }
    }

    await writeAudit({ action: "NOTIFICATION_TEST_SENT", adminId: admin.id, meta: { channel, isTest: true } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
