import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { FUNNEL_ORDER, getMetric } from "@/lib/analytics/metrics/registry";
import { metricAccessible } from "@/lib/analytics/access";
import { runAnalyticsQuery } from "@/lib/analytics/query";
import { assertEnabled, periodParams } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Two funnels, kept apart: the matrimonial lifecycle (cohort registered in the period) and the marketing funnel (provider numbers
// separate from our own). Neither implies that everyone should progress to the end.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:view");
    await assertEnabled();
    const p = periodParams(req.url);
    const lifecycle = FUNNEL_ORDER.filter((k) => { const d = getMetric(k); return d && metricAccessible(admin, d); });
    const marketing = ["marketing.impressions", "marketing.clicks", "marketing.landing_page_views", "marketing.leads", "marketing.registrations", "marketing.profiles_completed", "marketing.verified"].filter((k) => { const d = getMetric(k); return d && metricAccessible(admin, d); });
    const [life, mkt] = await Promise.all([
      lifecycle.length ? runAnalyticsQuery(admin, { metrics: lifecycle, period: { preset: p.period, from: p.from, to: p.to } }, { resource: "funnel" }) : null,
      marketing.length ? runAnalyticsQuery(admin, { metrics: marketing, period: { preset: p.period, from: p.from, to: p.to } }, { resource: "funnel" }) : null,
    ]);
    return NextResponse.json({
      lifecycle: life, marketing: mkt,
      notes: ["Lifecycle stages are a cohort: applicants registered in the period who have reached each stage as of now. Each stage includes every stage before it.", "Marketing figures are kept separate from the lifecycle. A marketing conversion is never a match, meeting or marriage outcome.", "Not every applicant is expected to progress to the end."],
    }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
