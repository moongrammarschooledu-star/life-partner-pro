import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { assertCommunicationAccess } from "@/lib/communication-access";
import { sendAdminComposedMessage } from "@/lib/notifications/notification-service";
import { containsContactPattern } from "@/lib/communications/thread-service";
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

    // STEP 24 — real backend enforcement of the risk-driven communication restrictions.
    if ((await hasActiveRestriction(profileId, "COMMUNICATION_RESTRICTED")) || (await hasActiveRestriction(profileId, "FULL_ACCOUNT_RESTRICTED"))) {
      throw new ApiError(403, "This profile is currently restricted from admin-initiated communication.");
    }

    // Free text that contains an e-mail address or phone number needs the sensitive-send permission (accidental-disclosure guard).
    if (containsContactPattern(message) && !admin.permissions.includes("communications:send_sensitive") && !admin.permissions.includes("sensitive:communication:send")) {
      throw new ApiError(403, "This message contains what looks like an e-mail address or phone number. Contact details cannot be sent without the sensitive-communication permission.");
    }

    let result;
    try {
      result = await sendAdminComposedMessage({
        profileId,
        proposalId: proposalId || undefined,
        channel,
        message: message.trim(),
        adminId: admin.id,
        permissions: admin.permissions,
      });
    } catch (error) {
      // A policy refusal (consent, suppression, jurisdiction, ...) is an answer for the admin, not a server fault.
      throw new ApiError(422, error instanceof Error ? error.message : "The message could not be sent.");
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
