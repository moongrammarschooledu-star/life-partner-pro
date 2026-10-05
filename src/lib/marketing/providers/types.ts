import type { MarketingObjective, MarketingProviderKey } from "@prisma/client";

// STEP 29 §5 — provider-neutral advertising adapter. This is deliberately NOT the STEP 25 CommunicationProvider
// (message-delivery shaped): ad platforms deal in campaigns, budgets, creatives and insights, and their hierarchies
// differ, so the internal model (MarketingAdNode) is a single self-referential table.

export interface AdCampaignSpec {
  name: string;
  objective: MarketingObjective;
  totalBudgetMinor: number;
  dailyBudgetMinor?: number | null;
  currencyCode: string;
  startAt?: Date | null;
  endAt?: Date | null;
  // Allow-listed targeting only (validated by the content policy before it can get here).
  targeting?: unknown;
}

export interface ProviderCampaignRef {
  externalId: string;
  name?: string;
  status: string;
}

export interface ProviderMetricRow {
  date: string; // YYYY-MM-DD
  externalId: string;
  impressions: number;
  reach: number;
  clicks: number;
  spendMinor: number;
  providerLeads: number;
}

export interface ProviderAd {
  id: string;
  name: string;
  status: string;
  parentId?: string;
}

export interface ProviderAdAccount {
  id: string;
  name: string;
  currency?: string;
}

// The ONLY shape that may be handed to an ad platform: event name, time, a random de-duplication id and a campaign
// reference. Never personal data, never hashed contact data, never the lead id (see ad-event.ts).
export interface AdPlatformEvent {
  eventName: string;
  eventTime: number;
  eventId: string;
  actionSource: "website";
  campaignRef?: string;
}

export interface MarketingWebhookRequest {
  rawBody: string;
  headers: Record<string, string | undefined>;
  url: string;
}

export type ParsedMarketingWebhookEvent =
  | { kind: "LEADGEN"; eventId: string; leadgenId: string; formId?: string; adId?: string; pageId?: string; occurredAt?: Date }
  | { kind: "WHATSAPP_MESSAGE"; eventId: string; messageId: string; fromPhone: string; text?: string; profileName?: string; occurredAt?: Date };

// A lead retrieved from a provider (Meta Lead Ads field data). Field names are provider-defined; only the keys the
// lead pipeline understands are ever read from it.
export interface ProviderLeadData {
  providerLeadId: string;
  fields: Record<string, string>;
  adId?: string;
  formId?: string;
  campaignId?: string;
  createdAt?: Date;
}

// The inbound half of a provider: signature verification, subscription handshake, event parsing and lead retrieval.
// WhatsApp lead capture only needs this half (it has its own secret/verify-token env names).
export interface MarketingWebhookAdapter {
  verifyWebhook(req: MarketingWebhookRequest): { valid: boolean; reason?: string };
  verifyHandshake(params: URLSearchParams): string | null;
  parseWebhookEvent(req: MarketingWebhookRequest): ParsedMarketingWebhookEvent[] | null;
  retrieveLead(leadgenId: string): Promise<ProviderLeadData | null>;
}

export interface MarketingProviderAdapter extends MarketingWebhookAdapter {
  readonly key: MarketingProviderKey;
  readonly sandbox: boolean;
  // Names of environment variables this adapter needs (names only — values are never stored or returned).
  readonly secretNames: readonly string[];
  isConfigured(): boolean;
  connect(): Promise<{ ok: boolean; message?: string }>;
  disconnect(): Promise<void>;
  validateCredentials(): Promise<{ ok: boolean; message?: string }>;
  getAdAccounts(): Promise<ProviderAdAccount[]>;
  getCampaigns(): Promise<ProviderCampaignRef[]>;
  createCampaign(spec: AdCampaignSpec): Promise<ProviderCampaignRef>;
  updateCampaign(externalId: string, patch: Partial<AdCampaignSpec>): Promise<ProviderCampaignRef>;
  pauseCampaign(externalId: string): Promise<ProviderCampaignRef>;
  resumeCampaign(externalId: string): Promise<ProviderCampaignRef>;
  getCampaignMetrics(externalId: string, range: { from: Date; to: Date }): Promise<ProviderMetricRow[]>;
  getAds(externalCampaignId: string): Promise<ProviderAd[]>;
  sendEvent(event: AdPlatformEvent): Promise<{ accepted: boolean; reason?: string }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured.`);
  }
}
