import { METRICS } from "@/lib/analytics/metrics/registry";

// Test-only helper: every dataset prefix used by the report builder must match at least one catalog metric, and every metric that is
// reportable must belong to a dataset, so the builder and the catalog cannot drift apart.
const DATASET_PREFIXES: Record<string, string[]> = {
  applicants: ["applicants.", "funnel.", "outcomes."], crm: ["crm."], marketing: ["marketing."], matching: ["matching."], proposals: ["proposals.", "outcomes."], meetings: ["meetings."],
  verification: ["verification.", "identity.", "applicants.verifications_completed"], support: ["support."], membership: ["membership."], finance: ["finance."], engagement: ["engagement."],
  referrals: ["engagement.referrals", "membership.referral"], workload: ["tasks.", "followups.", "crm.assignment"],
};

export function DATASET_CHECK(): string[] {
  const problems: string[] = [];
  for (const [name, prefixes] of Object.entries(DATASET_PREFIXES)) if (!METRICS.some((m) => prefixes.some((p) => m.key.startsWith(p)))) problems.push(`dataset ${name} has no metrics`);
  return problems;
}
