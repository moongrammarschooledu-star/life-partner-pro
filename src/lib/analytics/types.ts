import type { Permission } from "@/lib/permissions";
import type { Period } from "@/lib/analytics/time";

// STEP 31 — shared analytics types. Values are plain JS numbers: counts, minor-unit money (integers, per currency, never summed
// across currencies) and "minutes" for durations. Rates are derived at read time from a stored numerator + denominator.

export type MetricUnit = "COUNT" | "MINOR_MONEY" | "PERCENT" | "HOURS";
// PERIOD metrics are events/amounts within a date range (summed across days). SNAPSHOT metrics are "how many right now" (queues, totals).
export type MetricKind = "PERIOD" | "SNAPSHOT";

export const SECTIONS = [
  "executive", "operations", "crm", "marketing", "matching", "proposals", "meetings", "family", "verification", "identity", "risk",
  "support", "communications", "engagement", "membership", "finance", "tasks", "staff",
] as const;
export type SectionKey = (typeof SECTIONS)[number];

export interface MetricRow {
  dimensionValue: string; // "ALL" for the undimensioned total
  currency: string; // "" for non-money
  value: number;
  denominator?: number | null;
}

export interface MetricRange {
  fromDay: string;
  toDay: string;
  startUtc: Date;
  endUtc: Date;
}

export interface MetricComputeContext {
  tz: string;
  now: Date;
  activeEvents: string[]; // EngagementEventType names that make an applicant "active" (admin-configurable)
}

export type ComputeFn = (range: MetricRange, ctx: MetricComputeContext, dimension: string) => Promise<MetricRow[]>;

export interface MetricDefinition {
  key: string;
  name: string;
  description: string;
  section: SectionKey;
  unit: MetricUnit;
  kind: MetricKind;
  // How the number is calculated, in words (shown in the catalog, on tooltips and on exported reports)
  formula: string;
  source: string;
  filters: string[];
  exclusions: string[];
  owner: string;
  // words people use for it (drives the assistant; never executed)
  synonyms: string[];
  // dimensions a breakdown may use besides "ALL"
  dimensions: string[];
  // extra permissions needed on top of the section gate (e.g. analytics:finance:view)
  requires: Permission[];
  // the implementation currently used for new data ("v1"…); older versions remain callable so history stays reproducible
  computeVersion: string;
  compute: Record<string, ComputeFn>;
  // a RATE metric stores numerator in value and denominator in `denominator`; presentation is value/denominator×100
  isRate?: boolean;
  // minutes stored; presented as hours
  isDuration?: boolean;
  // cohort-style metrics ("of those who registered in the period, how many have reached X") change after the fact, so they are
  // ALWAYS computed live for the requested range and never stored in the daily mart
  liveOnly?: boolean;
  // extra context shown with the figure (e.g. "staff-recorded")
  note?: string;
}

export interface MetricValueRow {
  dimensionValue: string;
  currency: string;
  value: number | null;
  denominator: number | null;
  // what a person should read: the count/amount itself, a percentage (rates), or hours (durations); null = not available
  display: number | null;
  suppressed?: boolean;
}

export interface MetricResult {
  key: string;
  name: string;
  unit: MetricUnit;
  kind: MetricKind;
  version: string;
  section: SectionKey;
  definition: { formula: string; source: string; filters: string[]; exclusions: string[]; owner: string; note?: string };
  // one entry per currency for money metrics, one per dimension value for a breakdown, otherwise a single entry
  values: MetricValueRow[];
  previous?: MetricValueRow[];
  // keyed "dimensionValue|currency"; null = not available (no comparison value, or it was zero)
  changePct?: Record<string, number | null>;
  insufficient: boolean;
  note?: string;
}

export interface Freshness {
  mode: "DAILY_MART" | "LIVE" | "MIXED";
  updatedAt: string | null;
  period: string;
  source: string;
  refreshStatus: "OK" | "STALE" | "NEVER_REFRESHED" | "FAILED" | "NOT_APPLICABLE";
  label: string;
}

export interface PeriodContext {
  period: Period;
  comparison: Period | null;
}
