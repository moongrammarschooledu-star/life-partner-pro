import { prisma } from "@/lib/prisma";
import { hashSubject } from "@/lib/marketing/normalize";
import type { MarketingEventType } from "@prisma/client";

// STEP 29 §20 — standardised funnel events. Append-only, high-volume, retention-swept. Never throws: analytics must
// not break a lead submission. `subject` (e.g. a client key) is stored only as a salted hash.

export interface MarketingEventInput {
  type: MarketingEventType;
  campaignId?: string | null;
  landingPageId?: string | null;
  leadId?: string | null;
  variantKey?: string | null;
  subject?: string | null;
  occurredAt?: Date;
}

export async function recordMarketingEvent(input: MarketingEventInput): Promise<void> {
  try {
    await prisma.marketingEvent.create({
      data: {
        type: input.type,
        campaignId: input.campaignId ?? null,
        landingPageId: input.landingPageId ?? null,
        leadId: input.leadId ?? null,
        variantKey: input.variantKey ?? null,
        subjectHash: input.subject ? hashSubject(input.subject) : null,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  } catch (error) {
    console.error("[marketing] event record failed", error instanceof Error ? error.message : error);
  }
}
