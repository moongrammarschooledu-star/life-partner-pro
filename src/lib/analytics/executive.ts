import { prisma } from "@/lib/prisma";
import { metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { runAnalyticsQuery } from "@/lib/analytics/query";
import type { PeriodPreset } from "@/lib/analytics/time";
import type { MetricResult } from "@/lib/analytics/types";

// STEP 31 — facts for the executive summary / executive report. The rule layer is deliberately plain: it states what was observed,
// states simple calculations, offers an interpretation ONLY where a transparent rule fires (a queue grew by more than a set share on a
// large-enough sample; an SLA fell below a threshold), and labels every line OBSERVED / CALCULATED / INTERPRETATION / RECOMMENDATION.
// Nothing here predicts an outcome for a person and no figure is estimated.

export type FactKind = "OBSERVED" | "CALCULATED" | "INTERPRETATION" | "RECOMMENDATION";
export interface Fact { section: string; kind: FactKind; text: string; metric?: string }

export const SUMMARY_SECTIONS: Array<{ title: string; metrics: string[] }> = [
  { title: "Applicants", metrics: ["applicants.total", "applicants.new", "applicants.verified", "applicants.active", "applicants.pending_review"] },
  { title: "Verification", metrics: ["verification.queue", "applicants.verifications_completed"] },
  { title: "Matching and proposals", metrics: ["matching.matches_generated", "proposals.created", "proposals.pending_responses", "meetings.completed_period"] },
  { title: "Membership and revenue", metrics: ["membership.active_memberships", "finance.gross_revenue", "finance.refunds", "finance.net_revenue"] },
  { title: "Marketing", metrics: ["marketing.leads", "marketing.clicks", "marketing.spend"] },
  { title: "Support", metrics: ["support.open", "support.opened", "support.first_response_sla"] },
  { title: "Risk and safety", metrics: ["risk.open_cases"] },
  { title: "Operational workload", metrics: ["tasks.open", "tasks.overdue", "tasks.sla_compliance"] },
];

const GROWTH_ATTENTION_PCT = 25;
const SMALL_SAMPLE = 20;

function valueText(r: MetricResult): string {
  const v = r.values[0];
  if (!v || v.display === null) return "not available (insufficient verified data)";
  const money = r.unit === "MINOR_MONEY";
  const fmt = (d: number, c: string) => (money ? `${c || "PKR"} ${Math.trunc(d / 100).toLocaleString("en-US")}.${String(Math.abs(d) % 100).padStart(2, "0")}` : r.unit === "PERCENT" ? `${d}%` : r.unit === "HOURS" ? `${d} hours` : d.toLocaleString("en-US"));
  return r.values.map((x) => (x.display === null ? "not available" : fmt(x.display, x.currency))).join("; ");
}

// pure: facts from already-computed results (so it can be tested without a database)
export function factsFromResults(sections: Array<{ title: string; results: MetricResult[] }>, comparisonLabel: string | null): Fact[] {
  const facts: Fact[] = [];
  for (const s of sections) {
    for (const r of s.results) {
      facts.push({ section: s.title, kind: r.unit === "PERCENT" || r.unit === "HOURS" ? "CALCULATED" : "OBSERVED", metric: r.key, text: `${r.name}: ${valueText(r)}${r.kind === "SNAPSHOT" ? " (as of now)" : ""}.` });
      const v = r.values[0];
      const chg = v ? r.changePct?.[`${v.dimensionValue}|${v.currency}`] : null;
      if (comparisonLabel && chg !== null && chg !== undefined && Math.abs(chg) >= GROWTH_ATTENTION_PCT) {
        const sample = v?.value ?? 0;
        const queueLike = ["verification.queue", "tasks.open", "tasks.overdue", "support.open", "proposals.pending_responses", "applicants.pending_review", "risk.open_cases"].includes(r.key);
        if (queueLike && chg > 0 && sample >= SMALL_SAMPLE) {
          facts.push({ section: s.title, kind: "INTERPRETATION", metric: r.key, text: `${r.name} is ${chg}% higher than in ${comparisonLabel}, which may point to a growing backlog.` });
          facts.push({ section: s.title, kind: "RECOMMENDATION", metric: r.key, text: `Review staffing and assignment for ${r.name.toLowerCase()}.` });
        } else if (!queueLike) {
          facts.push({ section: s.title, kind: "CALCULATED", metric: r.key, text: `${r.name} changed by ${chg}% compared with ${comparisonLabel}.` });
        }
      }
      if (r.key === "tasks.sla_compliance" && v?.display !== null && v?.display !== undefined && v.display < 80) {
        facts.push({ section: s.title, kind: "INTERPRETATION", metric: r.key, text: `Task SLA compliance is ${v.display}%, below 80%, so some tasks are being completed after their due date.` });
      }
    }
  }
  return facts;
}

export interface ExecutiveFacts { period: string; comparison: string | null; freshness: string; facts: Fact[]; limitations: string[]; omitted: string[] }

export async function collectExecutiveFacts(viewer: Viewer, preset: PeriodPreset = "LAST_30_DAYS", now?: Date): Promise<ExecutiveFacts> {
  const sections: Array<{ title: string; results: MetricResult[] }> = [];
  const omitted: string[] = [];
  let period = "";
  let comparison: string | null = null;
  let freshness = "";
  for (const s of SUMMARY_SECTIONS) {
    const keys = s.metrics.filter((k) => { const d = getMetric(k); if (d && metricAccessible(viewer, d)) return true; if (d) omitted.push(d.name); return false; });
    if (!keys.length) continue;
    try {
      const res = await runAnalyticsQuery(viewer, { metrics: keys, period: { preset }, compare: "PREVIOUS_PERIOD" }, { now, skipAccessLog: true, resource: "executive_summary" });
      sections.push({ title: s.title, results: res.results });
      period = res.period.label;
      comparison = res.comparison?.label ?? comparison;
      freshness = res.freshness.label;
    } catch { omitted.push(s.title); }
  }
  const facts = factsFromResults(sections, comparison);
  const limitations: string[] = ["Figures are recorded activity; none is a forecast and none says anything about any individual."];
  if (omitted.length) limitations.push(`Not shown because you do not have access or the data was unavailable: ${[...new Set(omitted)].slice(0, 8).join(", ")}.`);
  if (viewer.permissions.includes("analytics:data_quality:view")) {
    const open = await prisma.analyticsDataQualityIssue.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } });
    if (open > 0) limitations.push(`${open} data-quality issue(s) are open and may affect some figures.`);
  }
  if (!facts.length) limitations.push("Insufficient verified data for a summary of this period.");
  return { period, comparison, freshness, facts, limitations, omitted };
}
