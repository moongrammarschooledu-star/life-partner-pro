import { prisma } from "@/lib/prisma";
import { createLead } from "@/lib/crm/lead-service";
import { autoAssign } from "@/lib/crm/assignment-service";
import { createFromEvent } from "@/lib/workflow/engine";
import { resolveReferralCode } from "@/lib/referrals/referral-service";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { marketingAudit } from "@/lib/marketing/audit";
import { triggerAutomation } from "@/lib/marketing/automation";
import { buildConsentRows, marketingOptInFrom, type SubmittedConsents } from "@/lib/marketing/consent-service";
import { checkLeadDuplicate } from "@/lib/marketing/dedup";
import { recordMarketingEvent } from "@/lib/marketing/events";
import { getPublishedForm } from "@/lib/marketing/form-service";
import { validateSubmission } from "@/lib/marketing/form-schema";
import { computeContactHashes, hashSubject } from "@/lib/marketing/normalize";
import { isContactSuppressed } from "@/lib/marketing/suppression";
import { verifyFormToken, verifyTouchToken } from "@/lib/marketing/tokens";
import type { LeadSource, MarketingChannel, SubmissionOutcome } from "@prisma/client";

// STEP 29 §14/§16/§17/§18/§24 — the public lead-capture pipeline. Order is deliberate:
//   published form → signed form token → idempotency CLAIM → validation → consent → suppression → abuse limits →
//   fail-closed de-duplication → attribution (verified touch token only) → referral → atomic Lead + consent +
//   attribution create → best-effort CRM routing, task, events, automation.
// Every externally visible outcome other than "invalid input" / "stale token" / "form unavailable" is the SAME
// accepted response (accepted, repeat, suppressed, flagged-duplicate, silently-rejected bot): the caller can never
// learn whether a number/email already exists, is suppressed, or was flagged.

const CHANNEL_TO_SOURCE: Record<MarketingChannel, LeadSource> = {
  WEBSITE: "WEBSITE", FACEBOOK: "FACEBOOK", INSTAGRAM: "INSTAGRAM", META_ADS: "AD_CAMPAIGN", WHATSAPP: "WHATSAPP", TIKTOK: "TIKTOK",
  YOUTUBE: "YOUTUBE", GOOGLE_ADS: "AD_CAMPAIGN", SEARCH: "AD_CAMPAIGN", EMAIL: "DIRECT", SMS: "DIRECT", REFERRAL: "REFERRAL", DIRECT: "DIRECT",
  EVENT: "EVENT", OTHER: "OTHER",
};

export function sourceForChannel(channel: MarketingChannel | null | undefined): LeadSource {
  return channel ? CHANNEL_TO_SOURCE[channel] : "WEBSITE";
}

export interface CaptureInput {
  formId: string;
  formToken: string;
  touchToken?: string | null;
  values: Record<string, unknown>;
  consents: SubmittedConsents;
  honeypot?: string | null;
  // Derived server-side from the request (never from the body).
  clientKey: string;
  now?: number;
}

export type CaptureResult =
  | { status: "ACCEPTED"; leadId: string | null }
  | { status: "INVALID"; reason: string }
  | { status: "STALE_TOKEN" }
  | { status: "UNAVAILABLE" };

const ABUSE_WINDOW_MS = 24 * 3_600_000;
const ABUSE_MAX_PER_CONTACT = 5;
const SPAM_WINDOW_MS = 3_600_000;
const SPAM_MAX_PER_IP = 8;

async function claim(data: { nonce: string; formId: string; formVersionId: string; ipHash: string; elapsedMs: number | null; phoneHash?: string | null; emailHash?: string | null }): Promise<boolean> {
  try {
    await prisma.leadFormSubmission.create({
      data: { idempotencyKey: data.nonce, formId: data.formId, formVersionId: data.formVersionId, outcome: "ACCEPTED", ipHash: data.ipHash, elapsedMs: data.elapsedMs, phoneHash: data.phoneHash ?? null, emailHash: data.emailHash ?? null },
    });
    return true;
  } catch {
    return false; // the nonce was already used: a retry / double-click
  }
}

async function finish(nonce: string, outcome: SubmissionOutcome, extra: { leadId?: string | null; rejectReason?: string | null } = {}) {
  await prisma.leadFormSubmission.update({ where: { idempotencyKey: nonce }, data: { outcome, leadId: extra.leadId ?? null, rejectReason: extra.rejectReason ?? null } }).catch(() => undefined);
}

export async function captureLead(input: CaptureInput): Promise<CaptureResult> {
  const now = input.now ?? Date.now();
  const ipHash = hashSubject(input.clientKey);

  const published = await getPublishedForm(input.formId);
  if (!published) return { status: "UNAVAILABLE" };
  const { form, version, fields, consentConfig } = published;

  // Bots that fill the hidden field get the normal accepted response and nothing is created.
  const tokenCheck = verifyFormToken(input.formToken, { formId: form.id, formVersionId: version.id }, now);
  const honeypotHit = !!input.honeypot && input.honeypot.trim().length > 0;
  if (honeypotHit || (!tokenCheck.valid && tokenCheck.reason === "TOO_FAST")) {
    await prisma.leadFormSubmission.create({ data: { idempotencyKey: `spam:${ipHash}:${now}:${Math.random().toString(36).slice(2, 8)}`, formId: form.id, formVersionId: version.id, outcome: "REJECTED_SPAM", ipHash, rejectReason: honeypotHit ? "HONEYPOT" : "TOO_FAST" } }).catch(() => undefined);
    const recent = await prisma.leadFormSubmission.count({ where: { ipHash, outcome: "REJECTED_SPAM", createdAt: { gte: new Date(now - SPAM_WINDOW_MS) } } }).catch(() => 0);
    if (recent >= SPAM_MAX_PER_IP) {
      await publishSecurityEvent({ eventType: "MARKETING_LEAD_ABUSE_SUSPECTED", source: "marketing-capture", ip: input.clientKey, outcome: "REVIEW_REQUIRED", meta: { kind: "AUTOMATED_FORM_ACTIVITY", count: recent }, idempotencyKey: `mkt-spam:${ipHash}:${Math.floor(now / SPAM_WINDOW_MS)}` });
    }
    return { status: "ACCEPTED", leadId: null };
  }
  if (!tokenCheck.valid) return { status: "STALE_TOKEN" };
  const nonce = tokenCheck.claims.nonce;
  const elapsedMs = now - tokenCheck.claims.issuedAt;

  // A nonce already used → same accepted response, nothing created (retry/double-click safe).
  const prior = await prisma.leadFormSubmission.findUnique({ where: { idempotencyKey: nonce }, select: { leadId: true } });
  if (prior) return { status: "ACCEPTED", leadId: prior.leadId };

  // Validation errors are client-fixable and do NOT consume the nonce.
  const validated = validateSubmission(fields, input.values);
  if (!validated.ok) return { status: "INVALID", reason: validated.reason };
  if (input.consents.inquiryContact !== true) return { status: "INVALID", reason: "Consent to be contacted about your inquiry is required" };
  const v = validated.value;

  const hashes = computeContactHashes({ phone: v.phone ?? v.whatsapp, email: v.email });
  const claimed = await claim({ nonce, formId: form.id, formVersionId: version.id, ipHash, elapsedMs, phoneHash: hashes.phoneHash, emailHash: hashes.emailHash });
  if (!claimed) return { status: "ACCEPTED", leadId: null };

  try {
    await recordMarketingEvent({ type: "FORM_SUBMITTED", campaignId: form.campaignId, subject: input.clientKey });

    // Suppression: a suppressed contact is never captured (staff can lift the suppression first).
    if (await isContactSuppressed(hashes.suppressionHashes)) {
      await finish(nonce, "SUPPRESSED");
      return { status: "ACCEPTED", leadId: null };
    }

    // Unusual repeat volume for the same contact → neutral security signal, no lead.
    const repeats = await prisma.leadFormSubmission.count({
      where: { OR: [...(hashes.phoneHash ? [{ phoneHash: hashes.phoneHash }] : []), ...(hashes.emailHash ? [{ emailHash: hashes.emailHash }] : [])], createdAt: { gte: new Date(now - ABUSE_WINDOW_MS) } },
    });
    if (repeats > ABUSE_MAX_PER_CONTACT) {
      await finish(nonce, "REJECTED_SPAM", { rejectReason: "REPEAT_VOLUME" });
      await publishSecurityEvent({ eventType: "MARKETING_LEAD_ABUSE_SUSPECTED", source: "marketing-capture", subject: hashes.phoneHash ?? hashes.emailHash, outcome: "REVIEW_REQUIRED", meta: { kind: "REPEATED_SUBMISSIONS", count: repeats }, idempotencyKey: `mkt-repeat:${hashes.phoneHash ?? hashes.emailHash}:${Math.floor(now / ABUSE_WINDOW_MS)}` });
      return { status: "ACCEPTED", leadId: null };
    }

    // Fail-CLOSED de-duplication: an error here propagates (caught below → claim released → nothing created).
    const verdict = await checkLeadDuplicate({ phoneHash: hashes.phoneHash, emailHash: hashes.emailHash, phoneE164: hashes.phoneE164, email: hashes.email });
    if (verdict.kind === "CERTAIN_REPEAT") {
      await prisma.leadEvent.create({ data: { leadId: verdict.existing.id, fromStatus: verdict.existing.status, toStatus: verdict.existing.status, reason: "Repeat marketing form submission (same identifiers)" } });
      await recordMarketingEvent({ type: "LEAD_DUPLICATE_DETECTED", campaignId: form.campaignId, leadId: verdict.existing.id });
      await finish(nonce, "ACCEPTED", { leadId: verdict.existing.id });
      return { status: "ACCEPTED", leadId: verdict.existing.id };
    }

    // Attribution: only a validly SIGNED touch token can claim a campaign. A missing/tampered token is UNVERIFIED.
    const touch = verifyTouchToken(input.touchToken ?? null, now);
    const verified = touch.valid;
    const touchClaims = touch.valid ? touch.claims : null;
    const campaignId = (touchClaims?.campaignId ?? null) || form.campaignId || null;
    const campaign = campaignId ? await prisma.marketingCampaign.findUnique({ where: { id: campaignId } }) : null;
    const attributedCampaign = campaign && campaign.status !== "ARCHIVED" ? campaign : null;

    // Referral: resolved server-side; the response never reveals whether the code was valid.
    let referralId: string | undefined;
    if (v.referralCode) {
      try {
        referralId = (await resolveReferralCode(v.referralCode))?.id;
      } catch {
        referralId = undefined;
      }
    }

    const consentRows = buildConsentRows(consentConfig, input.consents, {
      hasPhone: !!hashes.phoneE164, hasEmail: !!hashes.email, privacyNoticeVersionId: version.privacyNoticeVersionId, ipHash,
    });
    const flagged = verdict.kind === "POTENTIAL";
    const attrCode = await nextSequenceCode("ATTR");
    const utm = touchClaims?.utm ?? {};

    const lead = await createLead({
      fullName: v.fullName,
      email: hashes.email ?? undefined,
      phone: hashes.phoneE164 ?? undefined,
      city: v.city, area: v.area, inquiry: v.inquiry,
      source: sourceForChannel(attributedCampaign?.channel),
      campaign: attributedCampaign?.code,
      consentGiven: true,
      referralId,
      initialStatus: flagged ? "DUPLICATE_REVIEW_REQUIRED" : "NEW",
      legacyDuplicateCheck: false,
      extra: {
        campaignId: attributedCampaign?.id ?? null,
        landingPageId: touchClaims?.pageId ?? null,
        landingPageVersionId: touchClaims?.pageVersionId ?? null,
        formId: form.id, formVersionId: version.id,
        utmSource: utm.source ?? null, utmMedium: utm.medium ?? null, utmCampaign: utm.campaign ?? null, utmContent: utm.content ?? null, utmTerm: utm.term ?? null,
        clickIdType: touchClaims?.clickIdType ?? null, clickIdHash: touchClaims?.clickIdHash ?? null,
        preferredChannel: v.preferredChannel ?? null, preferredLanguage: attributedCampaign?.language ?? null,
        emailHash: hashes.emailHash, phoneHash: hashes.phoneHash, ipHash, capturedAt: new Date(now),
        privacyNoticeVersionId: version.privacyNoticeVersionId,
        marketingOptIn: marketingOptInFrom(consentRows),
        dedupeReason: flagged && verdict.kind === "POTENTIAL" ? verdict.reasons.join(",").slice(0, 190) : null,
        duplicateOfLeadId: flagged && verdict.kind === "POTENTIAL" ? (verdict.duplicateOfLeadId ?? null) : null,
      },
      consents: consentRows.map((r) => ({ ...r })),
      attribution: {
        code: attrCode,
        campaignId: attributedCampaign?.id ?? null,
        landingPageVersionId: touchClaims?.pageVersionId ?? null,
        verification: verified ? "VERIFIED" : "UNVERIFIED",
        utm: utm as never,
        clickIdType: touchClaims?.clickIdType ?? null, clickIdHash: touchClaims?.clickIdHash ?? null,
        referrerHost: touchClaims?.referrerHost ?? null,
        model: attributedCampaign?.attributionModel ?? null,
        touchedAt: touchClaims ? new Date(touchClaims.issuedAt) : null,
      },
    });

    await finish(nonce, flagged ? "DUPLICATE_REVIEW" : "ACCEPTED", { leadId: lead.id });
    await afterLeadCreated({ leadId: lead.id, leadCode: lead.leadCode, flagged, campaign: attributedCampaign, landingPageId: touchClaims?.pageId ?? null, formId: form.id, clientKey: input.clientKey, variantKey: touchClaims?.variantKey ?? null });
    return { status: "ACCEPTED", leadId: lead.id };
  } catch (error) {
    // Release the claim so the person's retry (same token) is not silently swallowed.
    await prisma.leadFormSubmission.delete({ where: { idempotencyKey: nonce } }).catch(() => undefined);
    console.error("[marketing] lead capture failed", error instanceof Error ? error.message : error);
    throw error;
  }
}

// Everything after the lead exists is best-effort: a failure here must never lose the lead or fail the submission.
export interface AfterLeadCreatedInput {
  leadId: string;
  leadCode: string;
  flagged: boolean;
  campaign: { id: string; code: string; routingDepartmentId: string | null; responsibleAdminId: string | null; createdById: string } | null;
  landingPageId: string | null;
  formId: string | null;
  clientKey: string;
  // Provider-originated leads record a WhatsApp/lead-ad event instead of a form-driven one.
  origin?: "FORM" | "META_LEADGEN" | "WHATSAPP_INBOUND";
  // A/B variant the server assigned when the page rendered (from the signed touch token).
  variantKey?: string | null;
}

export async function afterLeadCreated(p: AfterLeadCreatedInput): Promise<void> {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[marketing] post-capture step failed: ${name}`, e instanceof Error ? e.message : e);
    }
  };
  await step("audit", () => marketingAudit({ action: "MARKETING_LEAD_CAPTURED", actorId: null, resource: "lead", resourceId: p.leadId, after: { leadCode: p.leadCode, campaignId: p.campaign?.id ?? null, flaggedDuplicate: p.flagged } }));
  if (p.flagged) {
    await step("dup-event", () => recordMarketingEvent({ type: "LEAD_DUPLICATE_DETECTED", campaignId: p.campaign?.id, leadId: p.leadId, landingPageId: p.landingPageId }));
    await step("dup-audit", () => marketingAudit({ action: "MARKETING_LEAD_DEDUP_FLAGGED", actorId: null, resource: "lead", resourceId: p.leadId }));
    await step("dup-task", () => createFromEvent({ eventName: "marketing.lead.duplicate_review_required", dedupKey: `CRM_DUPLICATE_REVIEW:${p.leadId}`, resourceType: "LEAD", resourceId: p.leadId, taskType: "CRM_DUPLICATE_REVIEW", title: `Marketing lead ${p.leadCode} may duplicate an existing record` }));
    return; // never routed/automated until a human clears the duplicate flag
  }
  await step("event", () => recordMarketingEvent({ type: "LEAD_CREATED", campaignId: p.campaign?.id, landingPageId: p.landingPageId, leadId: p.leadId, variantKey: p.variantKey, subject: p.clientKey }));
  if (p.origin === "WHATSAPP_INBOUND") await step("wa-event", () => recordMarketingEvent({ type: "WHATSAPP_STARTED", campaignId: p.campaign?.id, leadId: p.leadId }));
  // The assignment ledger needs a real admin as its creator: the campaign owner stands in for the routing rule's author.
  if (p.campaign) {
    const actorId = p.campaign.responsibleAdminId ?? p.campaign.createdById;
    await step("assign", () => autoAssign("LEAD", p.leadId, p.campaign!.routingDepartmentId, actorId));
  }
  await step("task", () => createFromEvent({ eventName: "marketing.lead.created", dedupKey: `MKT_LEAD:${p.leadId}`, resourceType: "LEAD", resourceId: p.leadId, taskType: "CRM_LEAD_REVIEW", title: `Follow up new marketing lead ${p.leadCode}${p.campaign ? ` (${p.campaign.code})` : ""}` }));
  await step("automation", async () => {
    if (p.origin === "WHATSAPP_INBOUND") await triggerAutomation("WHATSAPP_STARTED", { leadId: p.leadId });
    else if (!p.origin || p.origin === "FORM") await triggerAutomation("FORM_SUBMITTED", { leadId: p.leadId });
    await triggerAutomation("LEAD_CREATED", { leadId: p.leadId });
  });
}
