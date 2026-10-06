import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { sectionAccessible } from "@/lib/analytics/access";
import { pipelineStatus } from "@/lib/analytics/pipeline";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { SECTION_TITLES } from "@/lib/analytics/dashboard-service";
import { SECTIONS } from "@/lib/analytics/types";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Analytics home: which sections the admin may open, whether each part is switched on, the settings that shape every figure.
export async function GET() {
  try {
    const admin = await requireAdmin("analytics:view");
    const flags = Object.fromEntries(await Promise.all(["analytics.enabled", "analytics.pipeline.enabled", "analytics.reports.enabled", "analytics.scheduled_reports.enabled", "analytics.alerts.enabled", "analytics.forecast.enabled", "ai.analytics_assistant.enabled"].map(async (f) => [f, await isFeatureEnabled(f)] as const)));
    const settings = await getAnalyticsSettings();
    const sections = SECTIONS.filter((s) => s !== "executive" && sectionAccessible(admin, s)).map((s) => ({ key: s, title: SECTION_TITLES[s] }));
    const pipeline = admin.permissions.includes("analytics:pipeline:view") ? await pipelineStatus() : null;
    return NextResponse.json({ flags, sections, settings: { timezone: settings.timezone, minGroupSize: settings.minGroupSize, freshnessSlaHours: settings.freshnessSlaHours }, pipeline }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
