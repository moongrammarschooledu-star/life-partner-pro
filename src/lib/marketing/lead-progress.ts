import { prisma } from "@/lib/prisma";
import { triggerAutomation, type AutomationTrigger } from "@/lib/marketing/automation";
import { recordMarketingEvent } from "@/lib/marketing/events";
import type { LeadStatus, MarketingEventType } from "@prisma/client";

// STEP 29 — keeps the marketing event stream and automation in step with the STEP 28 lead lifecycle. Called (never
// throwing, only for campaign/provider leads) from updateLeadStatus/convertLead and the verification hook. The funnel
// NUMBERS on the dashboard come from live joins, not from these events; the events exist for the attribution
// timeline and for automation triggers.

const STATUS_EVENT: Partial<Record<LeadStatus, { event: MarketingEventType; trigger: AutomationTrigger }>> = {
  REGISTRATION_STARTED: { event: "REGISTRATION_STARTED", trigger: "REGISTRATION_STARTED" },
  REGISTERED: { event: "REGISTRATION_COMPLETED", trigger: "REGISTRATION_COMPLETED" },
  CONVERTED: { event: "REGISTRATION_COMPLETED", trigger: "REGISTRATION_COMPLETED" },
};

export async function onLeadProgress(leadId: string, toStatus: LeadStatus): Promise<void> {
  try {
    const mapped = STATUS_EVENT[toStatus];
    if (!mapped) return;
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { campaignId: true, platform: true } });
    if (!lead || (!lead.campaignId && !lead.platform)) return; // not a marketing lead
    await recordMarketingEvent({ type: mapped.event, campaignId: lead.campaignId, leadId });
    await triggerAutomation(mapped.trigger, { leadId });
  } catch (error) {
    console.error("[marketing] lead progress hook failed", error instanceof Error ? error.message : error);
  }
}

// Verification milestone for an applicant who came from a marketing lead.
export async function onProfileVerified(profileId: string): Promise<void> {
  try {
    const lead = await prisma.lead.findFirst({ where: { convertedProfileId: profileId, OR: [{ campaignId: { not: null } }, { platform: { not: null } }] }, select: { id: true, campaignId: true } });
    if (!lead) return;
    await recordMarketingEvent({ type: "VERIFICATION_COMPLETED", campaignId: lead.campaignId, leadId: lead.id });
  } catch (error) {
    console.error("[marketing] verification hook failed", error instanceof Error ? error.message : error);
  }
}
