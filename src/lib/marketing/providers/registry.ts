import type { MarketingProviderKey } from "@prisma/client";
import { isProduction } from "@/lib/communications/environment";
import { MetaAdsAdapter, WhatsAppLeadAdapter } from "@/lib/marketing/providers/meta";
import { SandboxMarketingAdapter } from "@/lib/marketing/providers/sandbox";
import type { MarketingProviderAdapter, MarketingWebhookAdapter } from "@/lib/marketing/providers/types";

// STEP 29 — resolves the adapter for a provider. A real adapter is only ever used in PRODUCTION AND when its
// credentials are present; everywhere else (dev, staging, unconfigured) the sandbox adapter answers, so a laptop pointed
// at a copy of real data can never create a real ad campaign. Google/TikTok are declared but not implemented: they
// resolve to the sandbox and report NOT_CONFIGURED in the admin UI.

type EnvMap = Record<string, string | undefined>;

export const IMPLEMENTED_PROVIDERS: MarketingProviderKey[] = ["SANDBOX", "META"];

export function getMarketingAdapter(key: MarketingProviderKey, env: EnvMap = process.env): MarketingProviderAdapter {
  if (key === "META") {
    const meta = new MetaAdsAdapter(env);
    if (isProduction(env) && meta.isConfigured()) return meta;
  }
  return new SandboxMarketingAdapter();
}

// Webhooks verify signatures regardless of environment (a signed event is a signed event); what the environment
// controls is whether the pipeline acts on it (the lead-capture flag).
export function getWebhookAdapter(provider: string, env: EnvMap = process.env): { adapter: MarketingWebhookAdapter; providerKey: MarketingProviderKey; source: "META_LEADGEN" | "WHATSAPP_INBOUND" } | null {
  const p = provider.toLowerCase();
  if (p === "meta") return { adapter: new MetaAdsAdapter(env), providerKey: "META", source: "META_LEADGEN" };
  if (p === "whatsapp") return { adapter: new WhatsAppLeadAdapter(env), providerKey: "META", source: "WHATSAPP_INBOUND" };
  return null;
}

export function providerSupportsLive(key: MarketingProviderKey): boolean {
  return IMPLEMENTED_PROVIDERS.includes(key) && key !== "SANDBOX";
}
