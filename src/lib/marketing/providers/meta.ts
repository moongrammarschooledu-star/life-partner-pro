import { hmacHex, safeEqual } from "@/lib/communications/providers/shared";
import {
  type AdCampaignSpec, type AdPlatformEvent, type MarketingProviderAdapter, type MarketingWebhookAdapter, type MarketingWebhookRequest,
  type ParsedMarketingWebhookEvent, type ProviderAd, type ProviderAdAccount, type ProviderCampaignRef, type ProviderLeadData,
  type ProviderMetricRow, ProviderNotConfiguredError,
} from "@/lib/marketing/providers/types";

// STEP 29 §6 — Meta (Facebook/Instagram) Marketing API + Lead Ads. Secrets are read from environment variables by NAME
// only; nothing is stored in the database or returned to a client. No live credentials exist in this repository, so
// every call path here is verified with mocked fetch only. Campaigns are always created PAUSED (a human launch,
// governed by maker-checker, is what activates them).

type EnvMap = Record<string, string | undefined>;
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const OBJECTIVE_MAP: Record<string, string> = {
  LEAD_GENERATION: "OUTCOME_LEADS",
  WHATSAPP_INQUIRY: "OUTCOME_ENGAGEMENT",
  WEBSITE_TRAFFIC: "OUTCOME_TRAFFIC",
  REGISTRATION: "OUTCOME_LEADS",
  PROFILE_COMPLETION: "OUTCOME_TRAFFIC",
  VERIFICATION: "OUTCOME_TRAFFIC",
  MEMBERSHIP_PROMOTION: "OUTCOME_TRAFFIC",
  REFERRAL_GROWTH: "OUTCOME_TRAFFIC",
  AWARENESS: "OUTCOME_AWARENESS",
  EVENT_PROMOTION: "OUTCOME_AWARENESS",
  CUSTOM: "OUTCOME_TRAFFIC",
};

export const META_SECRET_NAMES = ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ACCESS_TOKEN", "META_APP_SECRET", "META_LEADS_VERIFY_TOKEN"] as const;

function signatureCheck(secret: string | undefined, req: MarketingWebhookRequest): { valid: boolean; reason?: string } {
  const s = secret?.trim();
  if (!s) return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  const header = req.headers["x-hub-signature-256"];
  if (!header || !header.startsWith("sha256=")) return { valid: false, reason: "MISSING_SIGNATURE" };
  return safeEqual(header.slice(7), hmacHex(s, req.rawBody)) ? { valid: true } : { valid: false, reason: "BAD_SIGNATURE" };
}

function handshake(expected: string | undefined, params: URLSearchParams): string | null {
  const e = expected?.trim();
  if (!e || params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token");
  return token && safeEqual(token, e) ? (params.get("hub.challenge") ?? null) : null;
}

export class MetaAdsAdapter implements MarketingProviderAdapter {
  readonly key = "META" as const;
  readonly sandbox = false;
  readonly secretNames = META_SECRET_NAMES;

  constructor(private readonly env: EnvMap = process.env, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  isConfigured(): boolean {
    return !!(this.env.META_ADS_ACCESS_TOKEN?.trim() && this.env.META_AD_ACCOUNT_ID?.trim());
  }

  private base(): string {
    return `https://graph.facebook.com/${this.env.META_API_VERSION?.trim() || "v20.0"}`;
  }

  private account(): string {
    const id = (this.env.META_AD_ACCOUNT_ID ?? "").trim().replace(/^act_/, "");
    if (!/^\d{5,25}$/.test(id)) throw new ProviderNotConfiguredError("Meta ad account");
    return `act_${id}`;
  }

  private async call(path: string, opts: { method?: "GET" | "POST"; params?: Record<string, string>; token?: string } = {}): Promise<Record<string, unknown>> {
    const token = opts.token ?? this.env.META_ADS_ACCESS_TOKEN?.trim();
    if (!token) throw new ProviderNotConfiguredError("Meta");
    const method = opts.method ?? "GET";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      let url = `${this.base()}/${path}`;
      const init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal } = { method, headers: { Authorization: `Bearer ${token}` }, signal: controller.signal };
      if (method === "GET") {
        const q = new URLSearchParams(opts.params ?? {}).toString();
        if (q) url += `?${q}`;
      } else {
        init.headers["Content-Type"] = "application/x-www-form-urlencoded";
        init.body = new URLSearchParams(opts.params ?? {}).toString();
      }
      const res = await this.fetchImpl(url, init);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`META_HTTP_${res.status}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect() {
    return this.validateCredentials();
  }
  async disconnect() {
    // Credentials live in the environment; nothing to revoke here.
  }
  async validateCredentials() {
    if (!this.isConfigured()) return { ok: false, message: "META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID are not set." };
    try {
      await this.call(this.account(), { params: { fields: "id,name" } });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "META_ERROR" };
    }
  }

  async getAdAccounts(): Promise<ProviderAdAccount[]> {
    const j = await this.call("me/adaccounts", { params: { fields: "id,name,currency", limit: "50" } });
    return ((j.data as Array<{ id: string; name?: string; currency?: string }>) ?? []).map((a) => ({ id: a.id, name: a.name ?? a.id, currency: a.currency }));
  }

  async getCampaigns(): Promise<ProviderCampaignRef[]> {
    const j = await this.call(`${this.account()}/campaigns`, { params: { fields: "id,name,status", limit: "100" } });
    return ((j.data as Array<{ id: string; name?: string; status?: string }>) ?? []).map((c) => ({ externalId: c.id, name: c.name, status: c.status ?? "UNKNOWN" }));
  }

  async createCampaign(spec: AdCampaignSpec): Promise<ProviderCampaignRef> {
    const params: Record<string, string> = {
      name: spec.name,
      objective: OBJECTIVE_MAP[spec.objective] ?? "OUTCOME_TRAFFIC",
      status: "PAUSED", // never created active — a governed launch activates it
      special_ad_categories: "[]",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    };
    if (spec.dailyBudgetMinor && spec.dailyBudgetMinor > 0) params.daily_budget = String(spec.dailyBudgetMinor);
    else params.lifetime_budget = String(spec.totalBudgetMinor);
    if (spec.endAt) params.stop_time = spec.endAt.toISOString();
    if (spec.startAt) params.start_time = spec.startAt.toISOString();
    const j = await this.call(`${this.account()}/campaigns`, { method: "POST", params });
    const id = String(j.id ?? "");
    if (!id) throw new Error("META_NO_CAMPAIGN_ID");
    return { externalId: id, name: spec.name, status: "PAUSED" };
  }

  async updateCampaign(externalId: string, patch: Partial<AdCampaignSpec>): Promise<ProviderCampaignRef> {
    const params: Record<string, string> = {};
    if (patch.name) params.name = patch.name;
    if (patch.dailyBudgetMinor) params.daily_budget = String(patch.dailyBudgetMinor);
    if (patch.endAt) params.stop_time = patch.endAt.toISOString();
    await this.call(this.safeId(externalId), { method: "POST", params });
    return { externalId, status: "UNKNOWN" };
  }

  private safeId(id: string): string {
    if (!/^\d{5,25}$/.test(id)) throw new Error("META_INVALID_ID");
    return id;
  }

  async pauseCampaign(externalId: string): Promise<ProviderCampaignRef> {
    await this.call(this.safeId(externalId), { method: "POST", params: { status: "PAUSED" } });
    return { externalId, status: "PAUSED" };
  }

  async resumeCampaign(externalId: string): Promise<ProviderCampaignRef> {
    await this.call(this.safeId(externalId), { method: "POST", params: { status: "ACTIVE" } });
    return { externalId, status: "ACTIVE" };
  }

  async getCampaignMetrics(externalId: string, range: { from: Date; to: Date }): Promise<ProviderMetricRow[]> {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const j = await this.call(`${this.safeId(externalId)}/insights`, {
      params: { fields: "impressions,reach,clicks,spend,actions", time_increment: "1", time_range: JSON.stringify({ since: day(range.from), until: day(range.to) }), limit: "100" },
    });
    type Row = { date_start?: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: Array<{ action_type: string; value: string }> };
    return ((j.data as Row[]) ?? []).filter((r) => r.date_start).map((r) => ({
      date: r.date_start as string,
      externalId,
      impressions: Number(r.impressions ?? 0) || 0,
      reach: Number(r.reach ?? 0) || 0,
      clicks: Number(r.clicks ?? 0) || 0,
      // Meta reports spend as a decimal string in the account currency's major unit; stored as integer minor units.
      spendMinor: Math.round((Number(r.spend ?? 0) || 0) * 100),
      providerLeads: Number((r.actions ?? []).find((a) => a.action_type === "lead")?.value ?? 0) || 0,
    }));
  }

  async getAds(externalCampaignId: string): Promise<ProviderAd[]> {
    const j = await this.call(`${this.safeId(externalCampaignId)}/ads`, { params: { fields: "id,name,status,adset_id", limit: "100" } });
    return ((j.data as Array<{ id: string; name?: string; status?: string; adset_id?: string }>) ?? []).map((a) => ({ id: a.id, name: a.name ?? a.id, status: a.status ?? "UNKNOWN", parentId: a.adset_id }));
  }

  // Server-side conversion events are an explicit, separately-flagged integration (marketing.conversion_api.enabled).
  // The payload is the allow-listed AdPlatformEvent only (no user_data at all) — see ad-event.ts.
  async sendEvent(event: AdPlatformEvent): Promise<{ accepted: boolean; reason?: string }> {
    const dataset = this.env.META_DATASET_ID?.trim();
    if (!this.isConfigured() || !dataset || !/^\d{5,25}$/.test(dataset)) return { accepted: false, reason: "NOT_CONFIGURED" };
    try {
      await this.call(`${dataset}/events`, {
        method: "POST",
        params: { data: JSON.stringify([{ event_name: event.eventName, event_time: event.eventTime, event_id: event.eventId, action_source: event.actionSource }]) },
      });
      return { accepted: true };
    } catch (e) {
      return { accepted: false, reason: e instanceof Error ? e.message : "META_ERROR" };
    }
  }

  verifyWebhook(req: MarketingWebhookRequest) {
    return signatureCheck(this.env.META_APP_SECRET, req);
  }

  verifyHandshake(params: URLSearchParams): string | null {
    return handshake(this.env.META_LEADS_VERIFY_TOKEN, params);
  }

  parseWebhookEvent(req: MarketingWebhookRequest): ParsedMarketingWebhookEvent[] | null {
    let json: { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: { leadgen_id?: string; form_id?: string; ad_id?: string; page_id?: string; created_time?: number } }> }> };
    try {
      json = JSON.parse(req.rawBody);
    } catch {
      return null;
    }
    if (!Array.isArray(json.entry)) return null;
    const out: ParsedMarketingWebhookEvent[] = [];
    for (const entry of json.entry) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
        const v = change.value;
        out.push({
          kind: "LEADGEN",
          eventId: `leadgen:${v.leadgen_id}`,
          leadgenId: String(v.leadgen_id),
          formId: v.form_id,
          adId: v.ad_id,
          pageId: v.page_id ?? entry.id,
          occurredAt: v.created_time ? new Date(v.created_time * 1000) : undefined,
        });
      }
    }
    return out.length ? out : null;
  }

  // A leadgen webhook carries only ids; the field data needs the page access token.
  async retrieveLead(leadgenId: string): Promise<ProviderLeadData | null> {
    const token = this.env.META_PAGE_ACCESS_TOKEN?.trim();
    if (!token || !/^\d{5,25}$/.test(leadgenId)) return null;
    const j = await this.call(leadgenId, { token });
    const fields: Record<string, string> = {};
    for (const f of (j.field_data as Array<{ name?: string; values?: string[] }>) ?? []) {
      if (f.name && f.values?.[0]) fields[f.name.toLowerCase()] = String(f.values[0]).slice(0, 300);
    }
    return {
      providerLeadId: leadgenId,
      fields,
      adId: j.ad_id ? String(j.ad_id) : undefined,
      formId: j.form_id ? String(j.form_id) : undefined,
      campaignId: j.campaign_id ? String(j.campaign_id) : undefined,
      createdAt: j.created_time ? new Date(String(j.created_time)) : undefined,
    };
  }
}

// WhatsApp lead capture: the user starts the conversation (click-to-WhatsApp ad or a direct message). Only the
// inbound half is needed — marketing never sends free text through this path. It deliberately uses the app's own
// WHATSAPP_* secret names (the same names STEP 25 uses), not META_APP_SECRET, because it is the WhatsApp Business app
// that signs these callbacks.
export class WhatsAppLeadAdapter implements MarketingWebhookAdapter {
  constructor(private readonly env: EnvMap = process.env) {}

  verifyWebhook(req: MarketingWebhookRequest) {
    return signatureCheck(this.env.WHATSAPP_APP_SECRET, req);
  }

  verifyHandshake(params: URLSearchParams): string | null {
    return handshake(this.env.WHATSAPP_VERIFY_TOKEN, params);
  }

  parseWebhookEvent(req: MarketingWebhookRequest): ParsedMarketingWebhookEvent[] | null {
    type Msg = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } };
    let json: { entry?: Array<{ changes?: Array<{ value?: { messages?: Msg[]; contacts?: Array<{ profile?: { name?: string }; wa_id?: string }> } }> }> };
    try {
      json = JSON.parse(req.rawBody);
    } catch {
      return null;
    }
    if (!Array.isArray(json.entry)) return null;
    const out: ParsedMarketingWebhookEvent[] = [];
    for (const entry of json.entry) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const m of value?.messages ?? []) {
          if (!m.id || !m.from || !/^\d{7,15}$/.test(m.from)) continue;
          const seconds = Number(m.timestamp);
          out.push({
            kind: "WHATSAPP_MESSAGE",
            eventId: `wamsg:${m.id}`,
            messageId: m.id,
            fromPhone: `+${m.from}`,
            // Only a short, plain-text inquiry is kept; media/other message types carry no usable text.
            text: m.type === "text" && m.text?.body ? m.text.body.slice(0, 300) : undefined,
            profileName: value?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 80),
            occurredAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined,
          });
        }
      }
    }
    return out.length ? out : null;
  }

  async retrieveLead(): Promise<ProviderLeadData | null> {
    return null;
  }
}
