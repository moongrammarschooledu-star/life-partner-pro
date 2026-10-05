import { createHash } from "crypto";
import type {
  AdCampaignSpec, AdPlatformEvent, MarketingProviderAdapter, MarketingWebhookRequest, ParsedMarketingWebhookEvent,
  ProviderAd, ProviderAdAccount, ProviderCampaignRef, ProviderLeadData, ProviderMetricRow,
} from "@/lib/marketing/providers/types";

// STEP 29 — the default adapter outside PRODUCTION or when no real provider is configured. It talks to nothing:
// campaigns get deterministic fake ids, state changes are acknowledged, and — deliberately — it returns NO metrics
// (fabricated numbers would be indistinguishable from real ones in an analytics dashboard). It also refuses every
// webhook (there is no secret to verify against), so a sandbox deployment cannot be fed forged events.
export class SandboxMarketingAdapter implements MarketingProviderAdapter {
  readonly key = "SANDBOX" as const;
  readonly sandbox = true;
  readonly secretNames: readonly string[] = [];

  isConfigured(): boolean {
    return true;
  }
  async connect() {
    return { ok: true, message: "Sandbox adapter — no external calls are made." };
  }
  async disconnect() {}
  async validateCredentials() {
    return { ok: true, message: "Sandbox adapter needs no credentials." };
  }
  async getAdAccounts(): Promise<ProviderAdAccount[]> {
    return [{ id: "sandbox-account", name: "Sandbox ad account", currency: "PKR" }];
  }
  async getCampaigns(): Promise<ProviderCampaignRef[]> {
    return [];
  }
  private idFor(name: string): string {
    return `sandbox_${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
  }
  async createCampaign(spec: AdCampaignSpec): Promise<ProviderCampaignRef> {
    return { externalId: this.idFor(spec.name), name: spec.name, status: "PAUSED" };
  }
  async updateCampaign(externalId: string): Promise<ProviderCampaignRef> {
    return { externalId, status: "PAUSED" };
  }
  async pauseCampaign(externalId: string): Promise<ProviderCampaignRef> {
    return { externalId, status: "PAUSED" };
  }
  async resumeCampaign(externalId: string): Promise<ProviderCampaignRef> {
    return { externalId, status: "ACTIVE" };
  }
  async getCampaignMetrics(): Promise<ProviderMetricRow[]> {
    return [];
  }
  async getAds(): Promise<ProviderAd[]> {
    return [];
  }
  async sendEvent(_event: AdPlatformEvent) { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { accepted: false, reason: "SANDBOX_NO_EXTERNAL_SEND" };
  }
  verifyWebhook(_req: MarketingWebhookRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
    return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  }
  verifyHandshake(): string | null {
    return null;
  }
  parseWebhookEvent(): ParsedMarketingWebhookEvent[] | null {
    return null;
  }
  async retrieveLead(): Promise<ProviderLeadData | null> {
    return null;
  }
}
