import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { analyticsAudit } from "@/lib/analytics/audit";
import { DEFAULT_KPIS, KPI_STATES, evaluateRatio, formulaMetrics, formulaText, kpiState, parseKpiFormula, type KpiFormula, type KpiState } from "@/lib/analytics/kpi";
import { runAnalyticsQuery } from "@/lib/analytics/query";
import { metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import type { CompareMode, PeriodPreset } from "@/lib/analytics/time";
import type { AnalyticsKpiFrequency, AnalyticsMetricStatus } from "@prisma/client";

// STEP 31 — KPI management. A KPI = a closed formula over catalog metrics + a version history + targets per frequency. Changing the
// formula creates a NEW VERSION (history is never rewritten); a KPI's targets are configuration, not facts, and are shown as such.
// Lifecycle: DRAFT -> UNDER_REVIEW -> APPROVED -> ACTIVE (-> SUSPENDED/RETIRED); reviewer is never the author.

const KEY_RE = /^[A-Z][A-Z0-9_]{2,59}$/;
const FREQ: AnalyticsKpiFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];

const PRESET_FOR: Record<AnalyticsKpiFrequency, PeriodPreset> = { DAILY: "YESTERDAY", WEEKLY: "LAST_7_DAYS", MONTHLY: "LAST_30_DAYS", QUARTERLY: "LAST_90_DAYS", YEARLY: "THIS_YEAR" };

export async function installDefaultKpis(actor: Viewer): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const k of DEFAULT_KPIS) {
    if (await prisma.analyticsKpi.findUnique({ where: { key: k.key }, select: { id: true } })) {
      existing++;
      continue;
    }
    const code = await nextSequenceCode("KPI");
    await prisma.analyticsKpi.create({
      data: {
        code, key: k.key, name: k.name, description: k.description, category: k.category, unit: k.unit, visibility: k.visibility ?? null, createdById: actor.id,
        versions: { create: { version: 1, formula: k.formula as never, formulaText: formulaText(k.formula), direction: k.direction, frequency: k.frequency, authorId: actor.id, changeSummary: "Installed default" } },
      },
    });
    created++;
  }
  if (created) await analyticsAudit({ action: "ANALYTICS_KPI_CHANGED", actorId: actor.id, resource: "kpi", resourceId: "install-defaults", after: { created } });
  return { created, existing };
}

export interface KpiInput { key: string; name: string; description: string; category: string; unit: string; direction?: string; frequency?: string; formula: unknown; visibility?: string | null }

export async function createKpi(actor: Viewer, input: KpiInput) {
  if (!KEY_RE.test(input.key)) throw new HttpError(422, "The KPI key must be 3-60 characters: capital letters, digits and underscores.");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120 || input.description.trim().length < 5) throw new HttpError(422, "A name and a description are required.");
  const formula = parseKpiFormula(input.formula);
  const direction = input.direction === "LOWER_BETTER" ? "LOWER_BETTER" : "HIGHER_BETTER";
  const frequency = (FREQ as string[]).includes(input.frequency ?? "") ? (input.frequency as AnalyticsKpiFrequency) : "MONTHLY";
  if (await prisma.analyticsKpi.findUnique({ where: { key: input.key }, select: { id: true } })) throw new HttpError(409, "A KPI with that key already exists.");
  const code = await nextSequenceCode("KPI");
  const row = await prisma.analyticsKpi.create({
    data: { code, key: input.key, name, description: input.description.trim().slice(0, 600), category: input.category.slice(0, 40), unit: input.unit.slice(0, 20), visibility: input.visibility ?? null, createdById: actor.id, ownerAdminId: actor.id,
      versions: { create: { version: 1, formula: formula as never, formulaText: formulaText(formula), direction, frequency, authorId: actor.id } } },
  });
  await analyticsAudit({ action: "ANALYTICS_KPI_CHANGED", actorId: actor.id, resource: "kpi", resourceId: row.id, after: { key: input.key, formula: formulaText(formula) } });
  return row;
}

// A formula change always creates a new version and sends the KPI back to DRAFT so it is reviewed again.
export async function newKpiVersion(actor: Viewer, id: string, input: { formula: unknown; direction?: string; frequency?: string; changeSummary: string }) {
  const kpi = await prisma.analyticsKpi.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!kpi) throw new HttpError(404, "KPI not found.");
  if (input.changeSummary.trim().length < 3) throw new HttpError(422, "Describe what changed.");
  const formula = parseKpiFormula(input.formula);
  const last = kpi.versions[0];
  const version = (last?.version ?? 0) + 1;
  await prisma.analyticsKpiVersion.create({
    data: { kpiId: id, version, formula: formula as never, formulaText: formulaText(formula), direction: input.direction === "LOWER_BETTER" ? "LOWER_BETTER" : input.direction === "HIGHER_BETTER" ? "HIGHER_BETTER" : last?.direction ?? "HIGHER_BETTER",
      frequency: (FREQ as string[]).includes(input.frequency ?? "") ? (input.frequency as AnalyticsKpiFrequency) : last?.frequency ?? "MONTHLY", authorId: actor.id, changeSummary: input.changeSummary.trim().slice(0, 300) },
  });
  await prisma.analyticsKpi.update({ where: { id }, data: { currentVersion: version, status: "DRAFT" } });
  await analyticsAudit({ action: "ANALYTICS_KPI_CHANGED", actorId: actor.id, resource: "kpi", resourceId: id, before: { version: last?.version, formula: last?.formulaText }, after: { version, formula: formulaText(formula) }, reason: input.changeSummary });
  return { id, version };
}

export async function advanceKpi(actor: Viewer, id: string, action: "SUBMIT" | "APPROVE" | "ACTIVATE" | "SUSPEND" | "RETIRE", reason: string): Promise<{ id: string; status: AnalyticsMetricStatus }> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const kpi = await prisma.analyticsKpi.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!kpi) throw new HttpError(404, "KPI not found.");
  const author = kpi.versions[0]?.authorId;
  let next: AnalyticsMetricStatus;
  if (action === "SUBMIT") {
    if (kpi.status !== "DRAFT") throw new HttpError(409, "Only a draft can be submitted.");
    next = "UNDER_REVIEW";
  } else if (action === "APPROVE") {
    if (kpi.status !== "UNDER_REVIEW") throw new HttpError(409, "Only a KPI under review can be approved.");
    if (actor.id === author) throw new HttpError(403, "A KPI version cannot be approved by the person who wrote it.");
    next = "APPROVED";
    await prisma.analyticsKpiVersion.update({ where: { kpiId_version: { kpiId: id, version: kpi.currentVersion } }, data: { reviewerId: actor.id, reviewedAt: new Date() } });
  } else if (action === "ACTIVATE") {
    if (kpi.status !== "APPROVED" && kpi.status !== "SUSPENDED") throw new HttpError(409, "Only an approved or suspended KPI can be activated.");
    next = "ACTIVE";
  } else if (action === "SUSPEND") {
    if (kpi.status !== "ACTIVE") throw new HttpError(409, "Only an active KPI can be suspended.");
    next = "SUSPENDED";
  } else {
    next = "RETIRED";
  }
  await prisma.analyticsKpi.update({ where: { id }, data: { status: next } });
  await analyticsAudit({ action: "ANALYTICS_KPI_CHANGED", actorId: actor.id, resource: "kpi", resourceId: id, before: { status: kpi.status }, after: { status: next }, reason });
  return { id, status: next };
}

export async function setKpiTarget(actor: Viewer, id: string, input: { frequency: string; targetValue: number; warningThreshold?: number | null; criticalThreshold?: number | null }) {
  if (!(FREQ as string[]).includes(input.frequency)) throw new HttpError(422, "Unknown frequency.");
  for (const n of [input.targetValue, input.warningThreshold ?? 0, input.criticalThreshold ?? 0]) if (typeof n !== "number" || !Number.isFinite(n)) throw new HttpError(422, "Targets and thresholds must be numbers.");
  const kpi = await prisma.analyticsKpi.findUnique({ where: { id }, select: { id: true } });
  if (!kpi) throw new HttpError(404, "KPI not found.");
  const frequency = input.frequency as AnalyticsKpiFrequency;
  const data = { targetValue: input.targetValue, warningThreshold: input.warningThreshold ?? null, criticalThreshold: input.criticalThreshold ?? null, setById: actor.id };
  const row = await prisma.analyticsKpiTarget.upsert({ where: { kpiId_frequency: { kpiId: id, frequency } }, update: data, create: { kpiId: id, frequency, ...data } });
  await analyticsAudit({ action: "ANALYTICS_KPI_CHANGED", actorId: actor.id, resource: "kpi_target", resourceId: id, after: { frequency, ...data } });
  return row;
}

export interface KpiEvaluation {
  id: string; code: string; key: string; name: string; description: string; category: string; unit: string; status: AnalyticsMetricStatus; version: number;
  formula: string; frequency: AnalyticsKpiFrequency; direction: string;
  value: number | null; currency: string;
  state: KpiState;
  target: { value: number; warning: number | null; critical: number | null } | null;
  note: string | null;
  period: string;
}

// Evaluate every KPI the viewer may see for the preset period. A KPI whose metrics the viewer cannot access is omitted, never partly shown.
export async function evaluateKpis(viewer: Viewer, opts: { period?: PeriodPreset; compare?: CompareMode; onlyActive?: boolean; now?: Date } = {}): Promise<KpiEvaluation[]> {
  const kpis = await prisma.analyticsKpi.findMany({ where: opts.onlyActive ? { status: "ACTIVE" } : { status: { not: "RETIRED" } }, orderBy: { key: "asc" }, take: 200, include: { versions: true, targets: true } });
  const settings = await getAnalyticsSettings();
  const out: KpiEvaluation[] = [];
  for (const k of kpis) {
    if (k.visibility && !viewer.permissions.includes(k.visibility)) continue;
    const v = k.versions.find((x) => x.version === k.currentVersion);
    if (!v) continue;
    let formula: KpiFormula;
    try {
      formula = parseKpiFormula(v.formula);
    } catch {
      continue; // a stored formula that no longer validates is never evaluated
    }
    if (!formulaMetrics(formula).every((m) => { const d = getMetric(m); return d && metricAccessible(viewer, d); })) continue;
    const preset = opts.period ?? PRESET_FOR[v.frequency];
    const target = k.targets.find((t) => t.frequency === v.frequency) ?? null;
    let value: number | null = null;
    let currency = "";
    let note: string | null = null;
    let periodLabel = "";
    try {
      const res = await runAnalyticsQuery(viewer, { metrics: formulaMetrics(formula), period: { preset }, compare: opts.compare ?? "NONE" }, { now: opts.now, resource: "kpi" });
      periodLabel = res.period.label;
      const first = res.results[0].values[0];
      if (formula.kind === "METRIC") {
        value = first?.display ?? null;
        currency = first?.currency ?? "";
        if (value === null) note = "Insufficient verified data.";
      } else {
        const num = res.results.find((r) => r.key === formula.numerator)?.values ?? [];
        const den = res.results.find((r) => r.key === formula.denominator)?.values ?? [];
        // money ÷ count: one value per currency of the numerator (the first is shown; the rest are on the detailed dashboard)
        const n = num[0];
        const d = den.find((x) => x.currency === "") ?? den[0];
        currency = n?.currency ?? "";
        value = evaluateRatio(n?.value ?? null, d?.value ?? null, formula.scale, settings.minGroupSize <= 5 ? 5 : settings.minGroupSize);
        if (value === null) note = "Insufficient verified data.";
      }
    } catch {
      note = "Not available.";
    }
    const state = kpiState(value, { direction: v.direction === "LOWER_BETTER" ? "LOWER_BETTER" : "HIGHER_BETTER", target: target?.targetValue ?? null, warning: target?.warningThreshold ?? null, critical: target?.criticalThreshold ?? null });
    out.push({
      id: k.id, code: k.code, key: k.key, name: k.name, description: k.description, category: k.category, unit: k.unit, status: k.status, version: k.currentVersion, formula: v.formulaText,
      frequency: v.frequency, direction: v.direction, value, currency, state,
      target: target ? { value: target.targetValue, warning: target.warningThreshold, critical: target.criticalThreshold } : null, note, period: periodLabel,
    });
  }
  return out;
}

export { KPI_STATES };
