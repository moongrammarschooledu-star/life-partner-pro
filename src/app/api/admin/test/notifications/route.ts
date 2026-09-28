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

    let sandboxed = false;
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
      // Uses the provider registry like every other send, so the environment guard applies: outside production a real provider is
      // only used for allow-listed test recipients, everything else goes to the sandbox provider.
      const { resolveProviderChain } = await import("@/lib/communications/providers/registry");
      const chain = await resolveProviderChain({ channel, destination: to.trim() });
      const first = chain[0];
      const result = await first.adapter.sendMessage({ to: to.trim(), body: `[TEST] ${message.trim()}`, subject: channel === "EMAIL" ? "Life Partner Pro — Test Notification" : undefined, purpose: "TEST" });
      if (!result.ok) throw new ApiError(502, result.error ?? "Test send failed");
      sandboxed = first.sandboxed || !first.adapter.external;
    }

    await writeAudit({ action: "NOTIFICATION_TEST_SENT", adminId: admin.id, meta: { channel, isTest: true } });

    return NextResponse.json({ ok: true, sandboxed });
  } catch (error) {
    return handleApiError(error);
  }
}
