import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { marketingBaseUrl } from "@/lib/marketing/hosts";
import { governingLawText, legalPagesReviewed } from "@/lib/public-site/legal";

// The acquisition funnel (STEP 35 §44):
//   visitors -> page views -> call-to-action clicks -> registration started   (anonymous public-site events, counted only when switched on)
//   -> registered -> profile completed -> submitted -> verification -> active  (the existing STEP 30 engagement events, which STEP 31 analytics uses)
// The two halves come from different sources, so the counts are for watching trends, not exact conversion ratios. A registered account is
// never treated as an active applicant: "active" is its own, later stage.

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  source: "site" | "platform";
}

export async function getPublicFunnel(days: number) {
  const windowDays = Math.min(90, Math.max(1, Math.floor(days) || 30));
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const site = { path: { not: null }, occurredAt: { gte: since } } as const;
  const engaged = (type: "USER_REGISTERED" | "PROFILE_COMPLETED" | "PROFILE_SUBMITTED" | "VERIFICATION_COMPLETED" | "PROFILE_ACTIVATED") => prisma.engagementEvent.count({ where: { type, occurredAt: { gte: since } } });

  const [views, visitors, clicks, started, registered, completed, submitted, verified, active, collecting] = await Promise.all([
    prisma.marketingEvent.count({ where: { type: "PAGE_VIEW", ...site } }),
    prisma.marketingEvent.groupBy({ by: ["subjectHash"], where: { type: "PAGE_VIEW", ...site } }).then((g) => g.length),
    prisma.marketingEvent.count({ where: { type: "CTA_CLICK", ...site } }),
    prisma.marketingEvent.count({ where: { type: "REGISTRATION_STARTED", ...site } }),
    engaged("USER_REGISTERED"),
    engaged("PROFILE_COMPLETED"),
    engaged("PROFILE_SUBMITTED"),
    engaged("VERIFICATION_COMPLETED"),
    engaged("PROFILE_ACTIVATED"),
    Promise.all([isFeatureEnabled("marketing.enabled"), isFeatureEnabled("marketing.site_events.enabled")]).then(([a, b]) => a && b),
  ]);

  const stages: FunnelStage[] = [
    { key: "visitors", label: "Visitors (anonymous)", count: visitors, source: "site" },
    { key: "views", label: "Page views", count: views, source: "site" },
    { key: "cta", label: "Call-to-action clicks", count: clicks, source: "site" },
    { key: "started", label: "Registration started", count: started, source: "site" },
    { key: "registered", label: "Registered", count: registered, source: "platform" },
    { key: "completed", label: "Profile completed", count: completed, source: "platform" },
    { key: "submitted", label: "Profile submitted", count: submitted, source: "platform" },
    { key: "verified", label: "Verification completed", count: verified, source: "platform" },
    { key: "active", label: "Active applicant", count: active, source: "platform" },
  ];
  return { windowDays, collecting, stages };
}

/** Facts the owner needs when checking that the public site is configured, with no secret in any of them. */
export async function getPublicSiteStatus() {
  const [siteEvents, approvalRequired] = await Promise.all([isFeatureEnabled("marketing.site_events.enabled"), isFeatureEnabled("content.approval_required")]);
  return {
    canonicalBaseConfigured: marketingBaseUrl() !== null,
    legalPagesReviewed: legalPagesReviewed(),
    governingLawConfigured: governingLawText() !== null,
    siteEventsEnabled: siteEvents,
    contentReviewRequired: approvalRequired,
  };
}
