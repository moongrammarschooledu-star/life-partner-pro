import { APPLICANT_METRICS, FUNNEL_METRICS, FUNNEL_STAGES, OUTCOME_METRICS } from "@/lib/analytics/metrics/applicants";
import { OPERATIONS_METRICS } from "@/lib/analytics/metrics/operations";
import { CRM_METRICS, FAMILY_METRICS, MATCHING_METRICS, MEETING_METRICS, PROPOSAL_METRICS, SUPPORT_METRICS } from "@/lib/analytics/metrics/pipeline-domains";
import { FINANCE_METRICS, MEMBERSHIP_METRICS } from "@/lib/analytics/metrics/money-domains";
import { COMMUNICATION_METRICS, ENGAGEMENT_METRICS, MARKETING_METRICS, RISK_METRICS } from "@/lib/analytics/metrics/signal-domains";
import type { MetricDefinition, SectionKey } from "@/lib/analytics/types";

// STEP 31 — the canonical metric catalog (code side). One definition per metric: the dashboards, reports, KPIs, the data marts,
// reconciliation and the assistant all resolve a metric key HERE, so "Verified Applicant" (or any other figure) can only mean one thing.
// Governance (owner/reviewer/status/version history) is stored in AnalyticsMetricDefinition/Version and seeded from this list.

export const METRICS: MetricDefinition[] = [
  ...APPLICANT_METRICS, ...FUNNEL_METRICS, ...OUTCOME_METRICS, ...OPERATIONS_METRICS, ...CRM_METRICS, ...MATCHING_METRICS, ...PROPOSAL_METRICS,
  ...MEETING_METRICS, ...FAMILY_METRICS, ...SUPPORT_METRICS, ...FINANCE_METRICS, ...MEMBERSHIP_METRICS, ...RISK_METRICS, ...COMMUNICATION_METRICS,
  ...ENGAGEMENT_METRICS, ...MARKETING_METRICS,
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function getMetric(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function listMetrics(section?: SectionKey): MetricDefinition[] {
  return section ? METRICS.filter((m) => m.section === section) : METRICS;
}

export function metricKeys(): string[] {
  return METRICS.map((m) => m.key);
}

// metrics that are additive per day and therefore stored in the daily mart (cohort/live-only ones are always computed live)
export function martMetrics(): MetricDefinition[] {
  return METRICS.filter((m) => !m.liveOnly);
}

export function metricCategory(m: MetricDefinition): string {
  return m.section;
}

export { FUNNEL_STAGES };

// ---------- the executive funnel in presentation order ----------
export const FUNNEL_ORDER = ["funnel.leads", ...FUNNEL_STAGES.map((s) => s.key)];
