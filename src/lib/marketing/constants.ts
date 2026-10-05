import type { ContentVersionStatus, LandingPageStatus, LeadFormStatus, MarketingCampaignStatus, MarketingCreativeStatus } from "@prisma/client";

// STEP 29 — state machines. `ACTIVE` for a campaign is deliberately reachable only through launchCampaign() /
// resumeCampaign() in campaign-service.ts (which run the full governance checks); the generic status route never
// accepts it, even though the transition is listed here as structurally valid.

export const CAMPAIGN_TRANSITIONS: Record<MarketingCampaignStatus, MarketingCampaignStatus[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["APPROVED", "DRAFT"],
  APPROVED: ["SCHEDULED", "ACTIVE", "DRAFT"],
  SCHEDULED: ["ACTIVE", "APPROVED"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ACTIVE", "COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionCampaign(from: MarketingCampaignStatus, to: MarketingCampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export const CONTENT_VERSION_TRANSITIONS: Record<ContentVersionStatus, ContentVersionStatus[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["APPROVED", "DRAFT", "REJECTED"],
  APPROVED: ["SUPERSEDED"],
  REJECTED: ["DRAFT"],
  SUPERSEDED: [],
};

export function canTransitionContentVersion(from: ContentVersionStatus, to: ContentVersionStatus): boolean {
  return CONTENT_VERSION_TRANSITIONS[from].includes(to);
}

export const CREATIVE_TRANSITIONS: Record<MarketingCreativeStatus, MarketingCreativeStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionCreative(from: MarketingCreativeStatus, to: MarketingCreativeStatus): boolean {
  return CREATIVE_TRANSITIONS[from].includes(to);
}

export const PAGE_TRANSITIONS: Record<LandingPageStatus, LandingPageStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["UNPUBLISHED", "ARCHIVED", "PUBLISHED"],
  UNPUBLISHED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

export const FORM_TRANSITIONS: Record<LeadFormStatus, LeadFormStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["UNPUBLISHED", "ARCHIVED", "PUBLISHED"],
  UNPUBLISHED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

// Feature-flag keys (registered in src/lib/ops/feature-flag-defs.ts; all default OFF).
export const MARKETING_FLAGS = {
  master: "marketing.enabled",
  publicPages: "marketing.public_pages.enabled",
  leadCapture: "marketing.lead_capture.enabled",
  providerSync: "marketing.provider_sync.enabled",
  automation: "marketing.automation.enabled",
  conversionApi: "marketing.conversion_api.enabled",
  aiAssistant: "ai.marketing_assistant.enabled",
} as const;

// Fields whose change after APPROVED invalidates the approval (the approved content hash no longer matches).
export const MATERIAL_CAMPAIGN_FIELDS = [
  "name", "description", "objective", "channel", "providerKey", "campaignKey", "utmSource", "utmMedium",
  "contentIdentifier", "startAt", "endAt", "currencyCode", "budgetTotalMinor", "budgetDailyMinor",
  "landingPageId", "formId", "targeting", "language",
] as const;

export const MAX_BUDGET_MINOR = 2_000_000_000; // stays inside Postgres INT4 (≈ 20M major units)
