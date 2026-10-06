import { z } from "zod";
import { HttpError } from "@/lib/http-error";
import { MIN_SAMPLE_SIZE } from "@/lib/reports/sample-size";
import { getMetric } from "@/lib/analytics/metrics/registry";

// STEP 31 — KPI formulas use a CLOSED grammar (no code, no SQL, no free text evaluated):
//   { kind: "METRIC", metric }                               the metric's value itself
//   { kind: "RATIO", numerator, denominator, scale }         numerator ÷ denominator × scale   (scale 1, 100 or 1000)
// A KPI therefore can only combine catalog metrics. States: NOT_AVAILABLE, ON_TRACK, ATTENTION_REQUIRED, CRITICAL — they describe a
// number against a target; they never rank people or teams.

export const KPI_STATES = ["NOT_AVAILABLE", "ON_TRACK", "ATTENTION_REQUIRED", "CRITICAL"] as const;
export type KpiState = (typeof KPI_STATES)[number];

export const kpiFormulaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("METRIC"), metric: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("RATIO"), numerator: z.string().min(1).max(80), denominator: z.string().min(1).max(80), scale: z.union([z.literal(1), z.literal(100), z.literal(1000)]) }).strict(),
]);
export type KpiFormula = z.infer<typeof kpiFormulaSchema>;

export function parseKpiFormula(input: unknown): KpiFormula {
  const parsed = kpiFormulaSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, "A KPI formula must be a single metric or a ratio of two metrics (scale 1, 100 or 1000).");
  const f = parsed.data;
  const keys = f.kind === "METRIC" ? [f.metric] : [f.numerator, f.denominator];
  for (const k of keys) if (!getMetric(k)) throw new HttpError(422, `Unknown metric in the formula: ${k.slice(0, 60)}`);
  if (f.kind === "RATIO") {
    const [n, d] = [getMetric(f.numerator), getMetric(f.denominator)];
    // money can only be divided by a count (e.g. cost per click); never money by money or a rate by anything
    if (n?.isRate || d?.isRate || n?.isDuration || d?.isDuration) throw new HttpError(422, "A ratio KPI can only combine counts or amounts, not other rates or durations.");
    if (d?.unit === "MINOR_MONEY") throw new HttpError(422, "An amount cannot be the denominator of a ratio KPI.");
  }
  return f;
}

export const formulaMetrics = (f: KpiFormula): string[] => (f.kind === "METRIC" ? [f.metric] : [f.numerator, f.denominator]);

export function formulaText(f: KpiFormula): string {
  if (f.kind === "METRIC") return f.metric;
  const unit = f.scale === 100 ? " × 100" : f.scale === 1000 ? " × 1000" : "";
  return `${f.numerator} ÷ ${f.denominator}${unit}`;
}

// numerator ÷ denominator × scale, null when there is no honest denominator (zero, or fewer than the minimum sample)
export function evaluateRatio(numerator: number | null, denominator: number | null, scale: number, minSample = MIN_SAMPLE_SIZE): number | null {
  if (numerator === null || denominator === null || denominator <= 0 || denominator < minSample) return null;
  return Math.round((numerator / denominator) * scale * 100) / 100;
}

export interface KpiThresholds {
  direction: "HIGHER_BETTER" | "LOWER_BETTER";
  target: number | null;
  warning: number | null;
  critical: number | null;
}

// A KPI is ON_TRACK while it is on the good side of the warning boundary (the target itself when no warning is set),
// ATTENTION_REQUIRED once it crosses the warning boundary, CRITICAL once it crosses the critical boundary.
export function kpiState(value: number | null, t: KpiThresholds): KpiState {
  if (value === null || Number.isNaN(value) || t.target === null) return "NOT_AVAILABLE";
  const boundary = t.warning ?? t.target;
  if (t.direction === "HIGHER_BETTER") {
    if (t.critical !== null && value < t.critical) return "CRITICAL";
    return value >= boundary ? "ON_TRACK" : "ATTENTION_REQUIRED";
  }
  if (t.critical !== null && value > t.critical) return "CRITICAL";
  return value <= boundary ? "ON_TRACK" : "ATTENTION_REQUIRED";
}

// Sensible starting set (installed as DRAFTS with no targets — targets are the business's decision, not facts).
export interface DefaultKpi { key: string; name: string; description: string; category: string; unit: "PERCENT" | "COUNT" | "MINOR_MONEY" | "HOURS"; direction: "HIGHER_BETTER" | "LOWER_BETTER"; frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY"; formula: KpiFormula; visibility?: string }

export const DEFAULT_KPIS: DefaultKpi[] = [
  { key: "PROFILE_COMPLETION_RATE", name: "Profile completion rate", description: "Completed profiles ÷ submitted profiles × 100 (cohort registered in the period).", category: "applicants", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "RATIO", numerator: "funnel.profile_completed", denominator: "funnel.submitted", scale: 100 } },
  { key: "VERIFICATION_RATE", name: "Verification rate", description: "Verified applicants ÷ submitted profiles × 100 (cohort registered in the period).", category: "verification", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "RATIO", numerator: "funnel.verified", denominator: "funnel.submitted", scale: 100 } },
  { key: "ACTIVATION_RATE", name: "Activation rate", description: "Active applicants ÷ verified applicants × 100 (cohort registered in the period).", category: "applicants", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "RATIO", numerator: "funnel.active", denominator: "funnel.verified", scale: 100 } },
  { key: "PROPOSAL_RESPONSE_RATE", name: "Proposal response rate", description: "Proposals created in the period with at least one response.", category: "proposals", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "METRIC", metric: "proposals.response_rate" } },
  { key: "MATCH_PROPOSAL_RATE", name: "Match proposal rate", description: "Matches generated in the period that led to a proposal.", category: "matching", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "METRIC", metric: "matching.proposal_rate" } },
  { key: "LEAD_CONVERSION_RATE", name: "Lead conversion rate", description: "Leads captured in the period that became applicants.", category: "crm", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "METRIC", metric: "crm.lead_conversion_rate" } },
  { key: "TASK_SLA_COMPLIANCE", name: "Task SLA compliance", description: "Tasks completed on or before their due date.", category: "operations", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "WEEKLY", formula: { kind: "METRIC", metric: "tasks.sla_compliance" } },
  { key: "SUPPORT_FIRST_RESPONSE_SLA", name: "Support first-response SLA", description: "Cases opened in the period answered within target.", category: "support", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "WEEKLY", formula: { kind: "METRIC", metric: "support.first_response_sla" } },
  { key: "PAYMENT_FAILURE_RATE", name: "Payment failure rate", description: "Failed payments ÷ payment outcomes in the period.", category: "finance", unit: "PERCENT", direction: "LOWER_BETTER", frequency: "WEEKLY", formula: { kind: "METRIC", metric: "finance.payment_failure_rate" }, visibility: "analytics:finance:view" },
  { key: "RENEWAL_RATE", name: "Renewal rate", description: "Renewals confirmed ÷ renewals due in the period.", category: "membership", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "METRIC", metric: "membership.renewal_rate" } },
  { key: "MARKETING_CTR", name: "Click-through rate", description: "Clicks ÷ impressions × 100 (provider-reported).", category: "marketing", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "RATIO", numerator: "marketing.clicks", denominator: "marketing.impressions", scale: 100 } },
  { key: "MARKETING_COST_PER_LEAD", name: "Cost per lead", description: "Verified ad spend ÷ marketing leads (per currency).", category: "marketing", unit: "MINOR_MONEY", direction: "LOWER_BETTER", frequency: "MONTHLY", formula: { kind: "RATIO", numerator: "marketing.spend", denominator: "marketing.leads", scale: 1 }, visibility: "marketing:budget:view" },
  { key: "REENGAGEMENT_RESPONSE_RATE", name: "Re-engagement response rate", description: "Re-engagement reminders that led to the action asked.", category: "engagement", unit: "PERCENT", direction: "HIGHER_BETTER", frequency: "MONTHLY", formula: { kind: "METRIC", metric: "engagement.reengagement_response_rate" } },
];
