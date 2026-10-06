import type { Permission } from "@/lib/permissions";
import type { MetricDefinition, MetricRow, SectionKey } from "@/lib/analytics/types";

// STEP 31 — AnalyticsAccessControlService (pure). The order of checks is: signed-in admin → analytics entry permission → section gate
// (domain permission, or analytics:cross_domain:view for NON-sensitive sections) → the metric's own extra permissions (finance, risk,
// security, sensitive, staff, marketing budget) → dimension permission → small-group suppression on breakdowns. Everything the page
// shows has passed through here; a page can hide a control, but only this decides what data is returned.

export interface Viewer {
  id: string;
  permissions: string[];
}

const has = (v: Viewer, p: Permission | string) => v.permissions.includes(p);

// Sections whose data is open to anyone who may use analytics at all (aggregate headline counts)
const OPEN_SECTIONS: SectionKey[] = ["executive"];
// Sections that can NEVER be opened by cross-domain access alone — they need the metric's own explicit permission
const EXPLICIT_ONLY: SectionKey[] = ["finance", "risk", "family", "identity", "staff"];

const DOMAIN_PERMISSIONS: Record<SectionKey, Permission[]> = {
  executive: [],
  operations: ["tasks:view", "staff:view", "crm:view"],
  tasks: ["tasks:view", "staff:view"],
  crm: ["crm:reports:view", "crm:view"],
  marketing: ["marketing:analytics:view"],
  matching: ["match:run", "candidate:recommend"],
  proposals: ["proposal:create", "match:run"],
  meetings: ["proposal:create", "match:run"],
  family: [],
  verification: ["verification:view"],
  identity: [],
  risk: [],
  support: ["cases:view"],
  communications: ["communications:analytics:view", "communication:view"],
  engagement: ["engagement:analytics:view"],
  membership: ["finance:dashboard:view"],
  finance: [],
  staff: [],
};

export function canUseAnalytics(v: Viewer): boolean {
  return has(v, "analytics:view") || has(v, "analytics:dashboard:view");
}

export function sectionAccessible(v: Viewer, section: SectionKey): boolean {
  if (!canUseAnalytics(v)) return false;
  if (OPEN_SECTIONS.includes(section)) return true;
  if (DOMAIN_PERMISSIONS[section].some((p) => has(v, p))) return true;
  if (EXPLICIT_ONLY.includes(section)) return false; // decided by the metric's own `requires`
  return has(v, "analytics:cross_domain:view");
}

// A metric in an explicit-only section is reachable when the viewer holds ALL of its own required permissions.
export function metricAccessible(v: Viewer, def: Pick<MetricDefinition, "section" | "requires">): boolean {
  if (!canUseAnalytics(v)) return false;
  if (!def.requires.every((p) => has(v, p))) return false;
  if (EXPLICIT_ONLY.includes(def.section)) return def.requires.length > 0;
  return sectionAccessible(v, def.section);
}

// dimensions that expose a person-level grouping need their own permission
const DIMENSION_REQUIRES: Record<string, Permission[]> = { assigned_staff: ["analytics:staff:view"] };

export function dimensionAccessible(v: Viewer, def: Pick<MetricDefinition, "dimensions">, dimension: string): boolean {
  if (dimension === "ALL") return true;
  if (!def.dimensions.includes(dimension)) return false;
  return (DIMENSION_REQUIRES[dimension] ?? []).every((p) => has(v, p));
}

export const isSensitiveMetric = (def: Pick<MetricDefinition, "requires">) =>
  def.requires.some((p) => ["analytics:sensitive:view", "analytics:finance:view", "analytics:risk:view", "analytics:security:view", "analytics:staff:view"].includes(p));

// ---------- small-group protection ----------
// A breakdown row whose count is below `minGroupSize` could point at an individual: it is hidden. Because a lone hidden row could be
// recovered by subtracting the visible rows from a total, the next-smallest row is hidden too (complementary suppression).
export function suppressSmallGroups<T extends Pick<MetricRow, "dimensionValue" | "value">>(rows: T[], minGroupSize: number): Array<T & { suppressed: boolean }> {
  const dimRows = rows.filter((r) => r.dimensionValue !== "ALL");
  const small = new Set(dimRows.filter((r) => r.value > 0 && r.value < minGroupSize).map((r) => r.dimensionValue));
  if (small.size === 1) {
    const next = dimRows.filter((r) => !small.has(r.dimensionValue) && r.value > 0).sort((a, b) => a.value - b.value)[0];
    if (next) small.add(next.dimensionValue);
  }
  return rows.map((r) => ({ ...r, suppressed: r.dimensionValue !== "ALL" && small.has(r.dimensionValue) }));
}

export const SUPPRESSED_TEXT = "Insufficient data for this breakdown.";
