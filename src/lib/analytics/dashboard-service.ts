import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { analyticsAudit, logAnalyticsAccess } from "@/lib/analytics/audit";
import { dimensionAccessible, isSensitiveMetric, metricAccessible, sectionAccessible, type Viewer } from "@/lib/analytics/access";
import { FUNNEL_ORDER, getMetric, listMetrics } from "@/lib/analytics/metrics/registry";
import { runAnalyticsQuery, type QueryResult } from "@/lib/analytics/query";
import { versionNumber } from "@/lib/analytics/query-version";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { COMPARE_MODES, PERIOD_PRESETS, dayDate, keyFromDbDate, resolvePeriod, type CompareMode, type PeriodPreset } from "@/lib/analytics/time";
import { SECTIONS, type MetricDefinition, type SectionKey } from "@/lib/analytics/types";
import type { DbViewer } from "@/lib/analytics/viewers";
import type { AnalyticsShareScope } from "@prisma/client";

// STEP 31 — dashboards. Two kinds:
//  1. Built-in dashboards (the executive page and one per section) — assembled from the metric catalog, never from SQL.
//  2. Saved dashboards (the dashboard builder) — a validated list of widgets, each naming catalog metrics and an allow-listed
//     dimension. A widget the OWNER cannot see cannot be saved; a widget a VIEWER cannot see is replaced by "not available to you"
//     when they open it, so sharing never widens anyone's access.

export const WIDGET_TYPES = ["KPI", "LINE", "AREA", "BAR", "PIE", "FUNNEL", "TABLE"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const widgetSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/),
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().min(3).max(80).refine((v) => !/[<>]/.test(v), "Plain text only."),
  metrics: z.array(z.string().min(1).max(80)).min(1).max(8),
  dimension: z.string().max(40).optional(),
  period: z.enum(PERIOD_PRESETS as [PeriodPreset, ...PeriodPreset[]]).optional(),
}).strict();
export const widgetsSchema = z.array(widgetSchema).min(1).max(20);
export type Widget = z.infer<typeof widgetSchema>;

// Rules that keep charts honest: a line/area is one metric over time; bar/pie are one metric split by one dimension (a pie only for
// parts of a whole, i.e. counts); a funnel is the canonical stages only.
export function validateWidgets(input: unknown, owner: Viewer): Widget[] {
  const parsed = widgetsSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, `Invalid dashboard: ${parsed.error.issues[0]?.message ?? "check the widgets"}.`);
  const ids = new Set<string>();
  for (const w of parsed.data) {
    if (ids.has(w.id)) throw new HttpError(422, "Widget ids must be unique.");
    ids.add(w.id);
    const defs = w.metrics.map((k) => {
      const d = getMetric(k);
      if (!d) throw new HttpError(422, `Unknown metric: ${k.slice(0, 60)}`);
      if (!metricAccessible(owner, d)) throw new HttpError(403, `You cannot use ${d.name} in a dashboard because you do not have access to it.`);
      return d;
    });
    if (w.dimension && !defs.every((d) => dimensionAccessible(owner, d, w.dimension as string))) throw new HttpError(422, "That breakdown is not available for one of the metrics.");
    if ((w.type === "LINE" || w.type === "AREA") && (w.metrics.length !== 1 || defs[0].kind !== "PERIOD" || defs[0].liveOnly)) throw new HttpError(422, "A line or area chart shows one daily metric over time (cohort and snapshot metrics have no daily series).");
    if ((w.type === "BAR" || w.type === "PIE") && (w.metrics.length !== 1 || !w.dimension)) throw new HttpError(422, "A bar or pie chart needs exactly one metric and one breakdown.");
    if (w.type === "PIE" && (defs[0].unit !== "COUNT" || defs[0].isRate)) throw new HttpError(422, "A pie chart is only for parts of a whole (counts).");
    if (w.type === "FUNNEL" && !w.metrics.every((m) => FUNNEL_ORDER.includes(m))) throw new HttpError(422, "A funnel can only use the funnel stages.");
  }
  return parsed.data;
}

// ---------- daily series (from the data mart only) ----------
export interface SeriesPoint { day: string; value: number }
export async function metricSeries(viewer: Viewer, key: string, preset: PeriodPreset, opts: { from?: string; to?: string; currency?: string; now?: Date } = {}): Promise<{ available: boolean; message?: string; points: SeriesPoint[]; currency: string }> {
  const def = getMetric(key);
  if (!def) throw new HttpError(404, "Unknown metric.");
  if (!metricAccessible(viewer, def)) throw new HttpError(403, "You do not have access to this metric.");
  if (def.kind !== "PERIOD" || def.liveOnly) return { available: false, message: "This metric has no daily series.", points: [], currency: "" };
  const settings = await getAnalyticsSettings();
  const period = resolvePeriod(preset, settings.timezone, opts.now ?? new Date(), { from: opts.from, to: opts.to });
  const rows = await prisma.analyticsDailyMetric.groupBy({
    by: ["date", "currencyCode"], where: { metricKey: key, metricVersion: versionNumber(def), dimensionKey: "ALL", tenantId: settings.tenantId, date: { gte: dayDate(period.fromDay), lte: dayDate(period.toDay) } }, _sum: { value: true, denominator: true }, orderBy: { date: "asc" },
  });
  if (!rows.length) return { available: false, message: "Daily figures appear after the first data-mart refresh.", points: [], currency: "" };
  const currency = opts.currency ?? rows.find((r) => r.currencyCode !== "")?.currencyCode ?? "";
  const points = rows.filter((r) => r.currencyCode === currency).map((r) => {
    const v = Number(r._sum.value ?? 0);
    const d = Number(r._sum.denominator ?? 0);
    return { day: keyFromDbDate(r.date), value: def.isRate ? (d > 0 ? Math.round((v / d) * 1000) / 10 : 0) : def.isDuration ? (d > 0 ? Math.round((v / d / 60) * 10) / 10 : 0) : v };
  });
  return { available: true, points, currency };
}

// ---------- built-in dashboards ----------
export const EXECUTIVE_METRICS = [
  "applicants.total", "applicants.new", "applicants.verified", "applicants.active", "applicants.pending_review", "matching.open_matches", "proposals.active", "proposals.pending_responses",
  "meetings.scheduled_now", "meetings.completed_period", "outcomes.finalization_reviews", "outcomes.married_recorded", "membership.active_memberships", "finance.gross_revenue", "finance.net_revenue",
  "support.open", "risk.open_cases", "verification.queue", "tasks.open",
];

export const SECTION_TITLES: Record<SectionKey, string> = {
  executive: "Executive", operations: "Operations", crm: "CRM & lifecycle", marketing: "Marketing", matching: "Matchmaking", proposals: "Proposals", meetings: "Meetings", family: "Family portal",
  verification: "Verification", identity: "Identity checks", risk: "Risk & safety", support: "Support", communications: "Communications", engagement: "Engagement", membership: "Membership",
  finance: "Finance", tasks: "Tasks & SLA", staff: "Staff performance",
};

export interface DashboardWidgetResult {
  metric: QueryResult["results"][number];
  breakdown?: QueryResult["results"][number];
  series?: { available: boolean; message?: string; points: SeriesPoint[]; currency: string };
}

export interface DashboardResponse {
  section: SectionKey;
  title: string;
  period: QueryResult["period"];
  comparison: QueryResult["comparison"];
  freshness: QueryResult["freshness"];
  widgets: DashboardWidgetResult[];
  restricted: string[];
  funnel?: QueryResult["results"];
}

// A section dashboard: every metric of the section that the viewer may see (headline total, plus a breakdown by its first dimension and
// a daily series for period metrics). Metrics the viewer may not see are listed by NAME ONLY so the page can say "restricted".
export async function getSectionDashboard(viewer: Viewer, section: SectionKey, opts: { period?: PeriodPreset; compare?: CompareMode; from?: string; to?: string; withSeries?: boolean; now?: Date } = {}): Promise<DashboardResponse> {
  if (!(SECTIONS as readonly string[]).includes(section)) throw new HttpError(404, "Unknown section.");
  const preset = opts.period ?? "LAST_30_DAYS";
  const compare = opts.compare ?? "PREVIOUS_PERIOD";
  const defs: MetricDefinition[] = section === "executive" ? (EXECUTIVE_METRICS.map(getMetric).filter(Boolean) as MetricDefinition[]) : listMetrics(section);
  const allowed = defs.filter((d) => metricAccessible(viewer, d));
  const restricted = defs.filter((d) => !allowed.includes(d)).map((d) => d.name);
  if (section !== "executive" && allowed.length === 0 && !sectionAccessible(viewer, section)) {
    await logAnalyticsAccess({ adminId: viewer.id, action: "DENIED", resource: `dashboard:${section}`, outcome: "DENIED" });
    throw new HttpError(403, "You do not have access to this analytics section.");
  }
  const period = { preset, from: opts.from, to: opts.to };
  const base = await runAnalyticsQuery(viewer, { metrics: allowed.length ? allowed.map((d) => d.key) : ["applicants.total"], period, compare }, { now: opts.now, skipAccessLog: true, resource: `dashboard:${section}` });
  const widgets: DashboardWidgetResult[] = [];
  for (const res of base.results) {
    if (!allowed.some((d) => d.key === res.key)) continue;
    const def = getMetric(res.key)!;
    const dim = def.dimensions.find((d) => dimensionAccessible(viewer, def, d));
    const w: DashboardWidgetResult = { metric: res };
    if (dim && section !== "executive") {
      try {
        w.breakdown = (await runAnalyticsQuery(viewer, { metrics: [def.key], period, dimension: dim }, { now: opts.now, skipAccessLog: true })).results[0];
      } catch { /* a breakdown that cannot be shown is simply omitted */ }
    }
    if (opts.withSeries && def.kind === "PERIOD" && !def.liveOnly) w.series = await metricSeries(viewer, def.key, preset, { from: opts.from, to: opts.to, now: opts.now }).catch(() => undefined);
    widgets.push(w);
  }
  let funnel: QueryResult["results"] | undefined;
  if (section === "executive") {
    const stages = FUNNEL_ORDER.map(getMetric).filter((d): d is MetricDefinition => !!d && metricAccessible(viewer, d));
    if (stages.length) funnel = (await runAnalyticsQuery(viewer, { metrics: stages.map((s) => s.key), period }, { now: opts.now, skipAccessLog: true })).results;
  }
  await logAnalyticsAccess({ adminId: viewer.id, action: "VIEW", resource: `dashboard:${section}`, sensitive: allowed.some(isSensitiveMetric) });
  return { section, title: SECTION_TITLES[section], period: base.period, comparison: base.comparison, freshness: base.freshness, widgets, restricted, funnel };
}

// ---------- saved dashboards ----------
export interface SavedDashboardInput { name: string; description?: string | null; widgets: unknown }

export async function createDashboard(owner: Viewer, input: SavedDashboardInput) {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) throw new HttpError(422, "A name of 3-120 characters is required.");
  const widgets = validateWidgets(input.widgets, owner);
  const code = await nextSequenceCode("DASH");
  const row = await prisma.analyticsDashboard.create({ data: { code, name, description: input.description?.trim().slice(0, 300) || null, ownerId: owner.id, widgets: widgets as never, versions: { create: { version: 1, widgets: widgets as never, authorId: owner.id } } } });
  await analyticsAudit({ action: "ANALYTICS_DASHBOARD_CHANGED", actorId: owner.id, resource: "dashboard", resourceId: row.id, after: { code, widgets: widgets.length } });
  return row;
}

export async function updateDashboard(editor: Viewer, id: string, input: Partial<SavedDashboardInput> & { status?: "ACTIVE" | "ARCHIVED" }) {
  const d = await prisma.analyticsDashboard.findUnique({ where: { id }, include: { shares: true } });
  if (!d) throw new HttpError(404, "Dashboard not found.");
  if (d.ownerId !== editor.id) throw new HttpError(403, "Only the owner can change a dashboard.");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (input.name.trim().length < 3) throw new HttpError(422, "A name of at least 3 characters is required.");
    data.name = input.name.trim().slice(0, 120);
  }
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 300) || null;
  if (input.status) data.status = input.status;
  if (input.widgets !== undefined) {
    const widgets = validateWidgets(input.widgets, editor);
    const version = d.currentVersion + 1;
    data.widgets = widgets;
    data.currentVersion = version;
    await prisma.analyticsDashboardVersion.create({ data: { dashboardId: id, version, widgets: widgets as never, authorId: editor.id } });
  }
  const row = await prisma.analyticsDashboard.update({ where: { id }, data: data as never });
  await analyticsAudit({ action: "ANALYTICS_DASHBOARD_CHANGED", actorId: editor.id, resource: "dashboard", resourceId: id, after: { version: row.currentVersion, status: row.status } });
  return row;
}

export async function shareDashboard(owner: Viewer, id: string, scope: AnalyticsShareScope, scopeValue = "") {
  const d = await prisma.analyticsDashboard.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, "Dashboard not found.");
  if (d.ownerId !== owner.id) throw new HttpError(403, "Only the owner can share a dashboard.");
  if (!owner.permissions.includes("analytics:dashboard:share")) throw new HttpError(403, "You cannot share dashboards.");
  // the sharer must be able to see EVERY widget they are sharing: you can never expose more than you can see yourself
  validateWidgets(d.widgets, owner);
  if (scope === "PRIVATE") {
    await prisma.analyticsDashboardShare.deleteMany({ where: { dashboardId: id } });
  } else {
    if ((scope === "TEAM" || scope === "DEPARTMENT") && scopeValue.trim().length < 1) throw new HttpError(422, "Choose the role or department to share with.");
    await prisma.analyticsDashboardShare.upsert({ where: { dashboardId_scope_scopeValue: { dashboardId: id, scope, scopeValue: scope === "ORGANIZATION" ? "" : scopeValue.slice(0, 60) } }, update: {}, create: { dashboardId: id, scope, scopeValue: scope === "ORGANIZATION" ? "" : scopeValue.slice(0, 60), sharedById: owner.id } });
  }
  await analyticsAudit({ action: "ANALYTICS_DASHBOARD_SHARED", actorId: owner.id, resource: "dashboard", resourceId: id, after: { scope, scopeValue } });
  await logAnalyticsAccess({ adminId: owner.id, action: "SHARE", resource: "dashboard", resourceId: id });
}

export function canSeeDashboard(viewer: DbViewer, d: { ownerId: string; status: string; shares: Array<{ scope: AnalyticsShareScope; scopeValue: string }> }): boolean {
  if (d.status === "ARCHIVED") return d.ownerId === viewer.id;
  if (d.ownerId === viewer.id) return true;
  if (!viewer.permissions.includes("analytics:dashboard:view")) return false;
  return d.shares.some((s) => s.scope === "ORGANIZATION" || (s.scope === "TEAM" && s.scopeValue === viewer.role) || (s.scope === "DEPARTMENT" && !!viewer.departmentId && s.scopeValue === viewer.departmentId));
}

export async function listDashboards(viewer: DbViewer) {
  const rows = await prisma.analyticsDashboard.findMany({ orderBy: { updatedAt: "desc" }, take: 200, include: { shares: true } });
  return rows.filter((d) => canSeeDashboard(viewer, d)).map((d) => ({ id: d.id, code: d.code, name: d.name, description: d.description, owner: d.ownerId === viewer.id, status: d.status, version: d.currentVersion, shares: d.ownerId === viewer.id ? d.shares.map((s) => ({ scope: s.scope, scopeValue: s.scopeValue })) : undefined, updatedAt: d.updatedAt }));
}

export interface RenderedWidget { id: string; type: WidgetType; title: string; available: boolean; reason?: string; result?: QueryResult["results"]; series?: Awaited<ReturnType<typeof metricSeries>> }

// Open a saved dashboard AS THE VIEWER: every widget is re-validated against the viewer's own access.
export async function renderDashboard(viewer: DbViewer, id: string, opts: { period?: PeriodPreset; compare?: CompareMode; now?: Date } = {}) {
  const d = await prisma.analyticsDashboard.findUnique({ where: { id }, include: { shares: true } });
  if (!d || !canSeeDashboard(viewer, d)) {
    await logAnalyticsAccess({ adminId: viewer.id, action: "DENIED", resource: "dashboard", resourceId: id, outcome: "DENIED" });
    throw new HttpError(404, "Dashboard not found."); // a hidden dashboard looks exactly like a missing one
  }
  const widgets = widgetsSchema.parse(d.widgets);
  const rendered: RenderedWidget[] = [];
  let freshness: QueryResult["freshness"] | null = null;
  let periodInfo: QueryResult["period"] | null = null;
  for (const w of widgets) {
    const defs = w.metrics.map(getMetric);
    if (defs.some((x) => !x || !metricAccessible(viewer, x))) {
      rendered.push({ id: w.id, type: w.type, title: w.title, available: false, reason: "Not available to you." });
      continue;
    }
    try {
      const preset = w.period ?? opts.period ?? "LAST_30_DAYS";
      const res = await runAnalyticsQuery(viewer, { metrics: w.metrics, period: { preset }, compare: opts.compare ?? "NONE", dimension: w.dimension }, { now: opts.now, skipAccessLog: true });
      freshness = res.freshness;
      periodInfo = res.period;
      const series = w.type === "LINE" || w.type === "AREA" ? await metricSeries(viewer, w.metrics[0], preset, { now: opts.now }) : undefined;
      rendered.push({ id: w.id, type: w.type, title: w.title, available: true, result: res.results, series });
    } catch (error) {
      rendered.push({ id: w.id, type: w.type, title: w.title, available: false, reason: error instanceof HttpError ? error.message : "Could not be calculated." });
    }
  }
  await logAnalyticsAccess({ adminId: viewer.id, action: "VIEW", resource: "dashboard", resourceId: id, sensitive: widgets.some((w) => w.metrics.some((m) => { const x = getMetric(m); return x && isSensitiveMetric(x); })) });
  return { id: d.id, code: d.code, name: d.name, description: d.description, version: d.currentVersion, widgets: rendered, freshness, period: periodInfo };
}

export { COMPARE_MODES };
