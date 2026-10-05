import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { extractClickId, extractUtm, referrerHostOf } from "@/lib/marketing/attribution";
import { assignVariant, parseExperimentVariants, type ExperimentVariant } from "@/lib/marketing/experiments";
import { getPublishedForm } from "@/lib/marketing/form-service";
import { getPublishedLandingPage } from "@/lib/marketing/landing-service";
import type { LandingSection } from "@/lib/marketing/landing-schema";
import { hashSubject } from "@/lib/marketing/normalize";
import { issueTouchToken } from "@/lib/marketing/tokens";
import type { ConsentConfig, FormFieldDef } from "@/lib/marketing/form-schema";
import type { LandingPage, LandingPageVersion } from "@prisma/client";

// STEP 29 §18/§28 — everything the public landing page needs, computed on the SERVER per request: the published
// version, the attribution this visit may claim (a campaign only counts if it actually uses THIS page — a visitor
// editing ?utm_campaign= to name some other campaign gets no credit for it), the A/B variant, and the signed touch
// token. Nothing client-supplied is trusted beyond sanitised UTM text.

export interface RenderedForm {
  formId: string;
  fields: FormFieldDef[];
  consentConfig: ConsentConfig;
  privacyNoticeVersionId: string;
}

export interface LandingRenderContext {
  page: LandingPage;
  version: LandingPageVersion;
  sections: LandingSection[];
  touchToken: string;
  language: "EN" | "UR";
  forms: Record<string, RenderedForm>;
  campaignId: string | null;
}

// Pure. Only the hero headline/subtitle and CTA labels can be overridden by a variant.
export function applyVariantOverrides(sections: LandingSection[], overrides: ExperimentVariant["overrides"]): LandingSection[] {
  if (!overrides) return sections;
  return sections.map((s) => {
    if (s.type === "HERO") return { ...s, heading: overrides.heroHeading ?? s.heading, subtitle: overrides.heroSubtitle ?? s.subtitle, ctaLabel: s.ctaLabel ? (overrides.ctaLabel ?? s.ctaLabel) : s.ctaLabel };
    if (s.type === "CTA") return { ...s, ctaLabel: overrides.ctaLabel ?? s.ctaLabel };
    return s;
  });
}

export async function buildLandingRenderContext(params: { slug: string; search: Record<string, string | string[] | undefined>; referer?: string | null; ip: string; userAgent: string }): Promise<LandingRenderContext | null> {
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.publicPages))) return null;
  const published = await getPublishedLandingPage(params.slug);
  if (!published) return null;
  const { page, version } = published;

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params.search)) if (typeof v === "string") usp.set(k, v);
  const utm = extractUtm(usp);
  const click = extractClickId(usp);

  // Campaign: the one named by a valid utm_campaign that actually uses this page, else the page's own campaign.
  let campaign = null;
  if (utm.campaign) {
    const byKey = await prisma.marketingCampaign.findUnique({ where: { campaignKey: utm.campaign.toLowerCase() } });
    if (byKey && byKey.status !== "ARCHIVED" && byKey.landingPageId === page.id) campaign = byKey;
  }
  if (!campaign && page.campaignId) campaign = await prisma.marketingCampaign.findUnique({ where: { id: page.campaignId } });
  if (campaign?.status === "ARCHIVED") campaign = null;

  let sections = published.sections;
  let experimentId: string | undefined;
  let variantKey: string | undefined;
  const exp = await prisma.marketingExperiment.findFirst({
    where: { status: "RUNNING", OR: [{ landingPageId: page.id }, ...(campaign ? [{ campaignId: campaign.id, landingPageId: null }] : [])] },
    orderBy: { createdAt: "asc" },
  });
  if (exp) {
    try {
      const variants = parseExperimentVariants(exp.variants);
      variantKey = assignVariant(exp.id, variants, hashSubject(`${params.ip}|${params.userAgent}`));
      experimentId = exp.id;
      sections = applyVariantOverrides(sections, variants.find((v) => v.key === variantKey)?.overrides);
    } catch {
      // A malformed experiment never breaks the page: serve the control content with no variant.
    }
  }

  const forms: Record<string, RenderedForm> = {};
  for (const s of sections) {
    if (s.type !== "FORM_EMBED" || forms[s.formId]) continue;
    const f = await getPublishedForm(s.formId);
    if (f) forms[s.formId] = { formId: f.form.id, fields: f.fields, consentConfig: f.consentConfig, privacyNoticeVersionId: f.version.privacyNoticeVersionId };
  }

  const touchToken = issueTouchToken({
    campaignId: campaign?.id ?? null, pageId: page.id, pageVersionId: version.id,
    utm: { source: utm.source, medium: utm.medium, campaign: utm.campaign, content: utm.content, term: utm.term },
    clickIdType: click?.type, clickIdHash: click?.hash, referrerHost: referrerHostOf(params.referer), experimentId, variantKey,
  });
  return { page, version, sections, touchToken, language: page.language === "UR" ? "UR" : "EN", forms, campaignId: campaign?.id ?? null };
}
