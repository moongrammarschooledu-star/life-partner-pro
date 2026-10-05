import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { createLead } from "@/lib/crm/lead-service";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { marketingAudit } from "@/lib/marketing/audit";
import { sanitizeUtm } from "@/lib/marketing/attribution";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { buildConsentRows } from "@/lib/marketing/consent-service";
import { checkLeadDuplicate } from "@/lib/marketing/dedup";
import { afterLeadCreated, sourceForChannel } from "@/lib/marketing/lead-capture-service";
import { computeContactHashes } from "@/lib/marketing/normalize";
import { getWebhookAdapter } from "@/lib/marketing/providers/registry";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { MarketingWebhookAdapter, ParsedMarketingWebhookEvent, ProviderLeadData } from "@/lib/marketing/providers/types";
import { isContactSuppressed } from "@/lib/marketing/suppression";
import type { MarketingCampaign, MarketingProviderKey } from "@prisma/client";

// STEP 29 §31 — provider webhooks (Meta Lead Ads `leadgen`, WhatsApp inbound messages).
//   RECEIVED → (signature VERIFIED) → PARSED → PROCESSED          or  REJECTED / FAILED / SKIPPED / PENDING_FETCH
// Never trusts the client: the signature is checked over the RAW body before anything is parsed; each event is stored
// under a unique idempotency key (replay protection); events older than 7 days are skipped; a rejected delivery never
// echoes why. With the master/lead-capture flags off a validly signed delivery is acknowledged with 200 {skipped:true}
// (no retry storm) and nothing is stored.

const STALE_EVENT_MS = 7 * 24 * 3_600_000;
const REJECT_BURST_WINDOW_MS = 10 * 60_000;
const REJECT_BURST_LIMIT = 5;

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
  // Present for a successful subscription handshake (plain-text challenge response).
  challenge?: string;
}

export function handleWebhookHandshake(provider: string, params: URLSearchParams): WebhookResult {
  const resolved = getWebhookAdapter(provider);
  if (!resolved) return { status: 404, body: { error: "Unknown provider." } };
  const challenge = resolved.adapter.verifyHandshake(params);
  return challenge === null ? { status: 403, body: { error: "Verification failed." } } : { status: 200, body: {}, challenge };
}

function hashBody(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function handleMarketingWebhook(provider: string, req: { rawBody: string; headers: Record<string, string | undefined>; url: string }, now = Date.now()): Promise<WebhookResult> {
  const resolved = getWebhookAdapter(provider);
  if (!resolved) return { status: 404, body: { error: "Unknown provider." } };
  const { adapter, providerKey, source } = resolved;
  const payloadHash = hashBody(req.rawBody);

  const verification = adapter.verifyWebhook(req);
  if (!verification.valid) {
    await prisma.marketingWebhookEvent.create({ data: { providerKey, source, idempotencyKey: `rejected:${payloadHash}:${now}`, payloadHash, status: "REJECTED", rejectReason: (verification.reason ?? "INVALID").slice(0, 100) } }).catch(() => undefined);
    await marketingAudit({ action: "MARKETING_WEBHOOK_REJECTED", actorId: null, resource: "webhook", resourceId: source, extra: { reason: verification.reason } }).catch(() => undefined);
    const burst = await prisma.marketingWebhookEvent.count({ where: { providerKey, status: "REJECTED", receivedAt: { gte: new Date(now - REJECT_BURST_WINDOW_MS) } } }).catch(() => 0);
    if (burst >= REJECT_BURST_LIMIT) {
      await publishSecurityEvent({ eventType: "MARKETING_WEBHOOK_ANOMALY", source: "marketing-webhook", subject: source, outcome: "REVIEW_REQUIRED", meta: { rejected: burst }, idempotencyKey: `mkt-wh:${source}:${Math.floor(now / REJECT_BURST_WINDOW_MS)}` });
    }
    return { status: 401, body: { error: "Invalid signature." } };
  }

  if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.leadCapture))) return { status: 200, body: { skipped: true } };

  const events = adapter.parseWebhookEvent(req);
  if (!events) return { status: 200, body: { ok: true, events: 0 } };

  let processed = 0;
  for (const e of events) {
    if (e.occurredAt && now - e.occurredAt.getTime() > STALE_EVENT_MS) continue;
    const idempotencyKey = `${source}:${e.eventId}`;
    let rowId: string;
    try {
      const row = await prisma.marketingWebhookEvent.create({ data: { providerKey, source, idempotencyKey, payloadHash, status: "RECEIVED", eventType: e.kind } });
      rowId = row.id;
    } catch {
      continue; // duplicate delivery (replay) — already handled
    }
    try {
      const outcome = e.kind === "LEADGEN" ? await processLeadgen(e, adapter, providerKey) : await processWhatsAppMessage(e);
      await prisma.marketingWebhookEvent.update({ where: { id: rowId }, data: { status: outcome.status, leadId: outcome.leadId ?? null, rejectReason: outcome.note ?? null, processedAt: new Date() } });
      if (outcome.status === "PROCESSED") processed++;
    } catch (error) {
      await prisma.marketingWebhookEvent.update({ where: { id: rowId }, data: { status: "FAILED", rejectReason: (error instanceof Error ? error.message : "ERROR").slice(0, 100), processedAt: new Date() } }).catch(() => undefined);
    }
  }
  return { status: 200, body: { ok: true, processed } };
}

type Outcome = { status: "PROCESSED" | "SKIPPED" | "PENDING_FETCH"; leadId?: string | null; note?: string };

async function campaignForAd(adId: string | undefined): Promise<MarketingCampaign | null> {
  if (!adId) return null;
  const node = await prisma.marketingAdNode.findFirst({ where: { externalId: adId }, select: { campaignId: true } });
  return node ? prisma.marketingCampaign.findUnique({ where: { id: node.campaignId } }) : null;
}

async function createProviderLead(params: {
  fullName: string; phone?: string; email?: string; city?: string; inquiry?: string;
  platform: string; providerLeadId: string; campaign: MarketingCampaign | null;
  method: string; origin: "META_LEADGEN" | "WHATSAPP_INBOUND"; utmCampaignClaim?: string;
}): Promise<Outcome> {
  const hashes = computeContactHashes({ phone: params.phone, email: params.email });
  if (!hashes.phoneHash && !hashes.emailHash) return { status: "SKIPPED", note: "NO_CONTACT" };
  if (await isContactSuppressed(hashes.suppressionHashes)) return { status: "SKIPPED", note: "SUPPRESSED" };

  const verdict = await checkLeadDuplicate({ phoneHash: hashes.phoneHash, emailHash: hashes.emailHash, phoneE164: hashes.phoneE164, email: hashes.email, platform: params.platform, providerLeadId: params.providerLeadId });
  if (verdict.kind === "EXACT_PROVIDER_LEAD" || verdict.kind === "CERTAIN_REPEAT") return { status: "SKIPPED", leadId: verdict.existing.id, note: "DUPLICATE" };
  const flagged = verdict.kind === "POTENTIAL";

  const consent = buildConsentRows(
    { inquiryContact: { required: true, text: params.method }, marketingUpdates: { enabled: false, defaultChecked: false }, whatsapp: { enabled: false, defaultChecked: false }, privacyNoticeLinkRequired: true },
    { inquiryContact: true },
    { hasPhone: !!hashes.phoneE164, hasEmail: !!hashes.email, privacyNoticeVersionId: null, ipHash: null, method: params.method },
  );

  const lead = await createLead({
    fullName: params.fullName.slice(0, 120) || "Inquiry",
    email: hashes.email ?? undefined, phone: hashes.phoneE164 ?? undefined, city: params.city?.slice(0, 80), inquiry: params.inquiry?.slice(0, 300),
    source: params.platform === "WHATSAPP" ? "WHATSAPP" : sourceForChannel(params.campaign?.channel ?? "META_ADS"),
    campaign: params.campaign?.code, consentGiven: true,
    initialStatus: flagged ? "DUPLICATE_REVIEW_REQUIRED" : "NEW",
    legacyDuplicateCheck: false,
    extra: {
      campaignId: params.campaign?.id ?? null, platform: params.platform, providerLeadId: params.providerLeadId.slice(0, 120),
      utmCampaign: sanitizeUtm(params.utmCampaignClaim) ?? null,
      emailHash: hashes.emailHash, phoneHash: hashes.phoneHash, capturedAt: new Date(),
      // Inquiry-follow-up evidence only: nothing in a provider lead or an inbound message is a marketing opt-in.
      marketingOptIn: false,
      dedupeReason: flagged && verdict.kind === "POTENTIAL" ? verdict.reasons.join(",").slice(0, 190) : null,
      duplicateOfLeadId: flagged && verdict.kind === "POTENTIAL" ? (verdict.duplicateOfLeadId ?? null) : null,
    },
    consents: consent.map((c) => ({ ...c })),
    attribution: {
      code: await nextSequenceCode("ATTR"),
      campaignId: params.campaign?.id ?? null,
      // A provider-signed lead mapped to a known ad is verified by the provider's own signature; a WhatsApp text claim is not.
      verification: params.origin === "META_LEADGEN" && params.campaign ? "VERIFIED" : "UNVERIFIED",
      utm: { source: params.platform.toLowerCase(), campaign: sanitizeUtm(params.utmCampaignClaim) ?? undefined } as never,
      model: params.campaign?.attributionModel ?? null,
      touchedAt: new Date(),
    },
  });
  await afterLeadCreated({ leadId: lead.id, leadCode: lead.leadCode, flagged, campaign: params.campaign, landingPageId: null, formId: null, clientKey: `provider:${params.platform}`, origin: params.origin });
  return { status: "PROCESSED", leadId: lead.id };
}

async function processLeadgen(e: Extract<ParsedMarketingWebhookEvent, { kind: "LEADGEN" }>, adapter: MarketingWebhookAdapter, providerKey: MarketingProviderKey): Promise<Outcome> {
  void providerKey;
  const data: ProviderLeadData | null = await adapter.retrieveLead(e.leadgenId);
  // A leadgen webhook carries only ids; without a page access token the field data cannot be fetched, so the event is
  // parked as PENDING_FETCH (visible to admins) rather than guessed at.
  if (!data) return { status: "PENDING_FETCH", note: "AWAITING_LEAD_RETRIEVAL" };
  const f = data.fields;
  const campaign = await campaignForAd(e.adId ?? data.adId);
  return createProviderLead({
    fullName: f.full_name ?? [f.first_name, f.last_name].filter(Boolean).join(" "),
    phone: f.phone_number ?? f.phone, email: f.email, city: f.city,
    platform: "META_LEADGEN", providerLeadId: e.leadgenId, campaign, method: "META_LEAD_FORM", origin: "META_LEADGEN",
  });
}

async function processWhatsAppMessage(e: Extract<ParsedMarketingWebhookEvent, { kind: "WHATSAPP_MESSAGE" }>): Promise<Outcome> {
  // A click-to-WhatsApp ad can prefill "ref:<campaign key>"; being text the user controls, it is only an UNVERIFIED claim.
  const claim = e.text?.match(/\bref[:=\s]+([a-z0-9][a-z0-9_-]{2,60})\b/i)?.[1]?.toLowerCase();
  return createProviderLead({
    fullName: e.profileName ?? "WhatsApp inquiry", phone: e.fromPhone, inquiry: e.text,
    platform: "WHATSAPP", providerLeadId: e.messageId, campaign: null, method: "WHATSAPP_INBOUND_MESSAGE", origin: "WHATSAPP_INBOUND", utmCampaignClaim: claim,
  });
}
