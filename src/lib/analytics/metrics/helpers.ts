import type { ComputeFn, MetricDefinition, MetricRange, MetricRow, MetricUnit, MetricKind, SectionKey } from "@/lib/analytics/types";
import type { Permission } from "@/lib/permissions";

// STEP 31 — small helpers every metric file uses. A metric is a plain definition plus a versioned compute function that only
// READS operational tables (count / groupBy / aggregate or one parameterised raw aggregate) and returns integers.

export const ALL = "ALL";

export function total(value: number, denominator: number | null = null, currency = ""): MetricRow[] {
  return [{ dimensionValue: ALL, currency, value, denominator }];
}

export const between = (r: MetricRange) => ({ gte: r.startUtc, lt: r.endUtc });

// Profile statuses that count as "active in matchmaking" and those that are further along (used by several metrics).
export const ACTIVE_PROFILE_STATUSES = ["ACTIVE", "MATCHING", "PROPOSAL_SENT", "WAITING_FOR_RESPONSE", "INTERESTED", "MEETING_ARRANGED"] as const;
export const ACTIVE_OR_BEYOND = [...ACTIVE_PROFILE_STATUSES, "FINALIZED", "MARRIED"] as const;

export interface MetricInput {
  key: string;
  name: string;
  description: string;
  section: SectionKey;
  unit: MetricUnit;
  kind: MetricKind;
  formula: string;
  source: string;
  filters?: string[];
  exclusions?: string[];
  owner?: string;
  synonyms?: string[];
  dimensions?: string[];
  requires?: Permission[];
  isRate?: boolean;
  isDuration?: boolean;
  liveOnly?: boolean;
  note?: string;
  v1: ComputeFn;
}

export function metric(i: MetricInput): MetricDefinition & { liveOnly?: boolean } {
  const { v1, ...rest } = i;
  return {
    filters: [], exclusions: [], owner: "Operations", synonyms: [], dimensions: [], requires: [], computeVersion: "v1",
    ...rest,
    compute: { v1 },
  };
}

// a COUNT metric over one Prisma delegate with an optional dimension (groupBy field)
type Delegate = {
  count: (args: { where?: unknown }) => Promise<number>;
  groupBy: (args: { by: string[]; where?: unknown; _count: { _all: true } }) => Promise<Array<Record<string, unknown> & { _count: { _all: number } }>>;
};

export async function countOrGroup(delegate: Delegate, where: Record<string, unknown>, dimension: string, dimensionField?: string): Promise<MetricRow[]> {
  if (dimension === ALL || !dimensionField) return total(await delegate.count({ where }));
  const groups = await delegate.groupBy({ by: [dimensionField], where, _count: { _all: true } });
  return groups.map((g) => ({ dimensionValue: String(g[dimensionField] ?? "UNKNOWN"), currency: "", value: g._count._all, denominator: null }));
}

// share of a whole expressed as numerator/denominator; presentation divides at read time (never stored as a float)
export const ratio = (numerator: number, denominator: number): MetricRow[] => total(numerator, denominator);
