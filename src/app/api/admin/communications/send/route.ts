import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCommunicationAccess } from "@/lib/communication-access";
import { sendAdminComposedMessage } from "@/lib/notifications/notification-service";
import type { NotificationChannel } from "@prisma/client";

const VALID_CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"];

// Spec §12 — the client must have already shown Recipient/Channel/Message/
// Related-Proposal in a ConfirmDialog before calling this; this route is the
// actual send once the admin has confirmed.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communication:send");
    const { profileId, proposalId, channel, message } = await req.json();

    if (!profileId || !VALID_CHANNELS.includes(channel) || !message?.trim()) {
      throw new ApiError(400, "profileId, a valid channel, and a message are required");
    }

    let proposal = null;
    if (proposalId) {
      proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
      if (!proposal) throw new ApiError(404, "Proposal not found");
      if (proposal.profileAId !== profileId && proposal.profileBId !== profileId) {
        throw new ApiError(400, "Profile is not part of this proposal");
      }
    }
    assertCommunicationAccess(admin, proposal);

    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
    if (!profile || profile.softDeleted) throw new ApiError(404, "Profile not found");

    const result = await sendAdminComposedMessage({
      profileId,
      proposalId: proposalId || undefined,
      channel,
      message: message.trim(),
      adminId: admin.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
