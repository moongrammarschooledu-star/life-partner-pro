import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { marketingAudit } from "@/lib/marketing/audit";
import { suppressContact } from "@/lib/marketing/suppression";
import type { ConsentConfig } from "@/lib/marketing/form-schema";
import type { MarketingConsentPurpose, NotificationChannel } from "@prisma/client";

// STEP 29 §13 — consent for a Profile-less lead. It is EVIDENCE (append-only rows with text version, notice version,
// jurisdiction, method, withdrawal), not a profile opt-in: nothing here is ever copied into ConsentGrant /
// CommunicationConsent. The communications policy engine independently requires an explicit per-profile marketing
// opt-in, and submitting a form is never that.

export function consentTextHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 32);
}

export interface SubmittedConsents {
  inquiryContact: boolean;
  marketingUpdates?: boolean;
  whatsapp?: boolean;
}

export interface ConsentRowDraft {
  purpose: MarketingConsentPurpose;
  channel: NotificationChannel | null;
  granted: boolean;
  textVersionHash: string;
  privacyNoticeVersionId: string | null;
  jurisdictionId: string | null;
  method: string;
  ipHash: string | null;
}

// Builds the evidence rows for a submission. The caller has already rejected a submission without inquiryContact.
// Consent blocks the form did not offer are ignored even if a client sends them (mass-assignment safe).
export function buildConsentRows(
  config: ConsentConfig,
  given: SubmittedConsents,
  ctx: { hasPhone: boolean; hasEmail: boolean; privacyNoticeVersionId: string | null; jurisdictionId?: string | null; ipHash: string | null; method?: string },
): ConsentRowDraft[] {
  const base = { privacyNoticeVersionId: ctx.privacyNoticeVersionId, jurisdictionId: ctx.jurisdictionId ?? null, method: ctx.method ?? "CHECKBOX", ipHash: ctx.ipHash };
  const rows: ConsentRowDraft[] = [
    { ...base, purpose: "INQUIRY_FOLLOWUP", channel: null, granted: given.inquiryContact === true, textVersionHash: consentTextHash(config.inquiryContact.text) },
  ];
  if (config.marketingUpdates.enabled && config.marketingUpdates.text) {
    const granted = given.marketingUpdates === true;
    const hash = consentTextHash(config.marketingUpdates.text);
    if (ctx.hasEmail) rows.push({ ...base, purpose: "MARKETING_UPDATES", channel: "EMAIL", granted, textVersionHash: hash });
    if (ctx.hasPhone) rows.push({ ...base, purpose: "MARKETING_UPDATES", channel: "SMS", granted, textVersionHash: hash });
  }
  if (config.whatsapp.enabled && config.whatsapp.text && ctx.hasPhone) {
    rows.push({ ...base, purpose: "WHATSAPP_CONTACT", channel: "WHATSAPP", granted: given.whatsapp === true, textVersionHash: consentTextHash(config.whatsapp.text) });
  }
  return rows;
}

export function marketingOptInFrom(rows: ConsentRowDraft[]): boolean {
  return rows.some((r) => r.granted && (r.purpose === "MARKETING_UPDATES" || r.purpose === "WHATSAPP_CONTACT"));
}

// Withdrawal (spec §13): marks every granted marketing/WhatsApp evidence row withdrawn, clears the lead's opt-in flag
// and — because withdrawal must actually stop outreach — adds a MARKETING suppression for the lead's destinations.
export async function withdrawLeadConsent(leadId: string, opts: { actorId?: string | null; reason: string }): Promise<{ withdrawn: number }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, email: true, phone: true } });
  if (!lead) throw new HttpError(404, "Lead not found.");
  const now = new Date();
  const res = await prisma.marketingLeadConsent.updateMany({
    where: { leadId, withdrawnAt: null, granted: true, purpose: { in: ["MARKETING_UPDATES", "WHATSAPP_CONTACT"] } },
    data: { withdrawnAt: now },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { marketingOptIn: false } });
  if (lead.email || lead.phone) {
    await suppressContact({ phone: lead.phone, email: lead.email, reason: "USER_REQUEST", scope: "MARKETING", note: "Consent withdrawn", actorId: opts.actorId ?? null }).catch(() => undefined);
  }
  await marketingAudit({ action: "MARKETING_CONSENT_WITHDRAWN", actorId: opts.actorId, resource: "lead", resourceId: leadId, after: { withdrawn: res.count }, reason: opts.reason });
  return { withdrawn: res.count };
}

// A lead may be messaged for marketing only while an un-withdrawn granted marketing row exists for that channel.
export async function hasActiveMarketingConsent(leadId: string, channel: NotificationChannel): Promise<boolean> {
  const row = await prisma.marketingLeadConsent.findFirst({
    where: { leadId, channel, granted: true, withdrawnAt: null, purpose: { in: ["MARKETING_UPDATES", "WHATSAPP_CONTACT"] } },
    select: { id: true },
  });
  return !!row;
}
