import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 31 §71–§73 — the analytics layer exercised end-to-end over an in-memory database: the pipeline builds the data mart from
// operational rows (idempotently and rebuildably), the query engine reads it with per-metric permissions, small groups are hidden,
// reconciliation proves source = calculation = mart (and shows a variance when they differ), data-quality issues open and close,
// alerts respect sample size / cooldown, scheduled reports stop when a recipient loses access, dashboards and reports never widen
// anyone's access, and exports are formula-safe and audited.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "bigint" ? Number(v) : (v as number));
function cmp(actual: unknown, c: Record<string, unknown>): boolean {
  if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
  if ("notIn" in c && (c.notIn as unknown[]).includes(actual)) return false;
  if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
  if ("lte" in c && !(actual != null && ms(actual) <= ms(c.lte))) return false;
  if ("lt" in c && !(actual != null && ms(actual) < ms(c.lt))) return false;
  if ("gte" in c && !(actual != null && ms(actual) >= ms(c.gte))) return false;
  if ("gt" in c && !(actual != null && ms(actual) > ms(c.gt))) return false;
  return true;
}
const OPS = ["in", "notIn", "not", "lte", "lt", "gte", "gt"];
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(v as Row[]).every((w) => matches(row, w))) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if (Object.keys(c).some((x) => OPS.includes(x))) { if (!cmp(row[k], c)) return false; continue; }
      if (k.includes("_")) { if (!matches(row, c as Row)) return false; continue; } // compound unique key
      continue; // a relation filter: not modelled
    }
    if (v instanceof Date) { if (!(row[k] instanceof Date) || (row[k] as Date).getTime() !== v.getTime()) return false; continue; }
    if (v === null ? row[k] != null : row[k] !== v) return false;
  }
  return true;
}
function applyData(r: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v;
}
const DEFAULTS: Record<string, Row> = {
  analyticsSettings: { timezone: "Asia/Karachi", minGroupSize: 5, freshnessSlaHours: 30, tenantId: "" },
  analyticsDailyMetric: { dimensionKey: "ALL", dimensionValue: "ALL", currencyCode: "", tenantId: "" },
  analyticsMart: { status: "SUCCEEDED", lastCoveredDate: null, lastRefreshedAt: null },
  analyticsReportSchedule: { status: "ACTIVE" },
  analyticsReport: { status: "ACTIVE", visibility: "PRIVATE", visibilityValue: "", currentVersion: 1 },
  analyticsDashboard: { status: "ACTIVE", currentVersion: 1 },
  analyticsAlertRule: { status: "ACTIVE", lastTriggeredAt: null },
  analyticsKpi: { status: "DRAFT", currentVersion: 1 },
  analyticsAlertEvent: { status: "OPEN" },
  analyticsDataQualityIssue: { status: "OPEN" },
  adminUser: { active: true, customRoleId: null, departmentId: null },
};
const UNIQUE: Record<string, string[]> = {
  analyticsDailyMetric: ["date", "metricKey", "metricVersion", "dimensionKey", "dimensionValue", "currencyCode", "tenantId"],
  analyticsDataQualityIssue: ["checkKey", "subjectRef"],
};
const NESTED: Record<string, [string, string, string]> = {
  analyticsReport: ["versions", "analyticsReportVersion", "reportId"],
  analyticsDashboard: ["versions", "analyticsDashboardVersion", "dashboardId"],
  analyticsKpi: ["versions", "analyticsKpiVersion", "kpiId"],
};

// relations supported by `include`: [child model, foreign key on the child] (one-to-many) or [parent model, local key] (many-to-one)
const RELATIONS: Record<string, Record<string, [string, string, "many" | "one"]>> = {
  analyticsDashboard: { shares: ["analyticsDashboardShare", "dashboardId", "many"] },
  analyticsKpi: { versions: ["analyticsKpiVersion", "kpiId", "many"], targets: ["analyticsKpiTarget", "kpiId", "many"] },
  analyticsMetricDefinition: { versions: ["analyticsMetricVersion", "metricId", "many"] },
  analyticsReport: { schedules: ["analyticsReportSchedule", "reportId", "many"] },
  analyticsReportSchedule: { report: ["analyticsReport", "reportId", "one"] },
  analyticsAlertEvent: { rule: ["analyticsAlertRule", "ruleId", "one"] },
  analyticsReconciliationRun: { items: ["analyticsReconciliationItem", "runId", "many"] },
};
function withIncludes(t: string, row: Row, include: Record<string, unknown> | undefined): Row {
  if (!include) return row;
  const out: Row = { ...row };
  for (const [name, opt] of Object.entries(include)) {
    const rel = RELATIONS[t]?.[name];
    if (!rel) continue;
    const [child, key, kind] = rel;
    if (kind === "one") { out[name] = rows(child).find((r) => r.id === row[key]) ?? null; continue; }
    let list = rows(child).filter((r) => r[key] === row.id).map((r) => ({ ...r }));
    const o = (opt && typeof opt === "object" ? opt : {}) as { orderBy?: Row; take?: number };
    if (o.orderBy) { const [k, dir] = Object.entries(o.orderBy)[0]; list.sort((a, b) => (ms(a[k]) > ms(b[k]) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
    if (o.take) list = list.slice(0, o.take);
    out[name] = list;
  }
  return out;
}

function model(t: string) {
  const dup = (row: Row) => UNIQUE[t] && rows(t).some((r) => UNIQUE[t].every((k) => ms(r[k]) === ms(row[k]) && String(r[k]) === String(row[k])));
  const group = (list: Row[], by: string[]) => {
    const m = new Map<string, Row[]>();
    for (const r of list) { const k = by.map((b) => (r[b] instanceof Date ? (r[b] as Date).getTime() : String(r[b]))).join("|"); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.values()];
  };
  return {
    create: async ({ data }: { data: Row }) => {
      const { [NESTED[t]?.[0] ?? "__none"]: nested, ...rest } = data as Row;
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + idc), startedAt: new Date(Date.now() + idc), ...DEFAULTS[t], ...rest };
      if (dup(row)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows(t).push(row);
      const n = NESTED[t];
      if (n && nested && (nested as { create?: Row }).create) await model(n[1]).create({ data: { ...(nested as { create: Row }).create, [n[2]]: row.id } });
      return { ...row };
    },
    createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      let n = 0;
      for (const d of data) {
        const row: Row = { id: `${t}-${++idc}`, computedAt: new Date(), ...DEFAULTS[t], ...d };
        if (dup(row)) { if (skipDuplicates) continue; throw new Error("unique"); }
        rows(t).push(row);
        n++;
      }
      return { count: n };
    },
    findFirst: async ({ where, include, orderBy }: { where?: Row; include?: Row; orderBy?: Row } = {}) => {
      const list = rows(t).filter((x) => matches(x, where));
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob) { const [key, dir] = Object.entries(ob as Row)[0]; list.sort((a, b) => (ms(a[key]) > ms(b[key]) ? 1 : ms(a[key]) < ms(b[key]) ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
      return list[0] ? withIncludes(t, { ...list[0] }, include) : null;
    },
    findUnique: async ({ where, include }: { where: Row; include?: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? withIncludes(t, { ...r }, include) : null; },
    findMany: async ({ where, take, distinct, orderBy, include }: { where?: Row; take?: number; distinct?: string[]; orderBy?: Row; include?: Row } = {}) => {
      let out = rows(t).filter((x) => matches(x, where)).map((r) => withIncludes(t, { ...r }, include));
      if (distinct) { const seen = new Set<string>(); out = out.filter((r) => { const k = distinct.map((d) => (r[d] instanceof Date ? (r[d] as Date).getTime() : String(r[d]))).join("|"); if (seen.has(k)) return false; seen.add(k); return true; }); }
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob) { const [key, dir] = Object.entries(ob as Row)[0]; out.sort((a, b) => (ms(a[key]) > ms(b[key]) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      return take ? out.slice(0, take) : out;
    },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    groupBy: async ({ by, where, _sum, _count, _max }: { by: string[]; where?: Row; _sum?: Record<string, boolean>; _count?: Record<string, boolean>; _max?: Record<string, boolean> }) =>
      group(rows(t).filter((x) => matches(x, where)), by).map((g) => {
        const out: Row = {};
        for (const b of by) out[b] = g[0][b];
        if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map((f) => [f, g.reduce((s, r) => s + (Number(ms(r[f])) || 0), 0)]));
        if (_count) out._count = Object.fromEntries(Object.keys(_count).map((f) => [f === "_all" ? "_all" : f, g.length]));
        if (_max) out._max = Object.fromEntries(Object.keys(_max).map((f) => [f, g.map((r) => r[f]).filter(Boolean).sort((a, b) => ms(b) - ms(a))[0] ?? null]));
        return out;
      }),
    aggregate: async ({ where, _sum }: { where?: Row; _sum?: Record<string, boolean> }) => ({ _sum: Object.fromEntries(Object.keys(_sum ?? {}).map((f) => [f, rows(t).filter((x) => matches(x, where)).reduce((s, r) => s + (Number(r[f]) || 0), 0)])) }),
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); applyData(r, data); return { ...r }; },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const m = rows(t).filter((x) => matches(x, where)); m.forEach((r) => applyData(r, data)); return { count: m.length }; },
    upsert: async ({ where, update, create }: { where: Row; update: Row; create: Row }) => {
      const r = rows(t).find((x) => matches(x, where));
      if (r) { applyData(r, update); return { ...r }; }
      const row: Row = { id: `${t}-${++idc}`, ...DEFAULTS[t], ...create };
      rows(t).push(row);
      return { ...row };
    },
    deleteMany: async ({ where }: { where?: Row }) => { const keep = rows(t).filter((x) => !matches(x, where)); const n = rows(t).length - keep.length; db.set(t, keep); return { count: n }; },
  };
}

const addAdmins = (...list: Row[]) => { for (const a of list) rows("adminUser").push({ active: true, customRoleId: null, departmentId: null, ...a }); };
const flags = new Set<string>();
const audits: Row[] = [];
const sent: Row[] = [];
const permsByAdmin = new Map<string, string[]>();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, name: string) => (name === "$transaction" ? async (ops: Promise<unknown>[]) => Promise.all(ops) : name === "$queryRaw" ? async () => [] : model(name)) }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: vi.fn(async (a: Row) => { sent.push(a); }) }));
vi.mock("@/lib/effective-permissions", () => ({ resolveEffectivePermissions: vi.fn(async (a: { role: string; customRoleId: string | null }) => permsByAdmin.get(a.role) ?? []) }));

const pipeline = await import("./pipeline");
const engine = await import("./query");
const recon = await import("./reconciliation");
const quality = await import("./data-quality");
const alerts = await import("./alerts");
const scheduler = await import("./report-scheduler");
const reportsSvc = await import("./report-service");
const dashSvc = await import("./dashboard-service");
const { loadViewer } = await import("./viewers");

// 12:00 on 15 Oct 2026 in Karachi
const NOW = new Date("2026-10-15T07:00:00Z");
const TODAY_10AM = new Date("2026-10-15T05:00:00Z");
const YESTERDAY_10AM = new Date("2026-10-14T05:00:00Z");
const v = (...p: string[]) => ({ id: "viewer-1", permissions: p });
const BASE = ["analytics:view", "analytics:dashboard:view", "analytics:cross_domain:view", "analytics:reports:view"];

function seedApplicants() {
  for (let i = 0; i < 3; i++) rows("profile").push({ id: `p-today-${i}`, createdAt: TODAY_10AM, softDeleted: false, verified: i === 0, status: "NEW", profileCompletion: 50 });
  rows("profile").push({ id: "p-yest", createdAt: YESTERDAY_10AM, softDeleted: false, verified: true, status: "ACTIVE", profileCompletion: 100 });
  rows("profile").push({ id: "p-deleted", createdAt: TODAY_10AM, softDeleted: true, verified: false, status: "NEW", profileCompletion: 10 });
}

beforeEach(() => {
  db.clear(); audits.length = 0; sent.length = 0; flags.clear(); permsByAdmin.clear(); idc = 0;
  engine.clearAnalyticsCache();
  for (const f of ["analytics.enabled", "analytics.pipeline.enabled", "analytics.reports.enabled", "analytics.scheduled_reports.enabled", "analytics.alerts.enabled", "analytics.forecast.enabled"]) flags.add(f);
});

describe("pipeline and query engine", () => {
  it("calculates live before the data mart exists, and from the mart after", async () => {
    seedApplicants();
    const q = { metrics: ["applicants.new"], period: { preset: "LAST_7_DAYS" as const } };
    const live = await engine.runAnalyticsQuery(v(...BASE), q, { now: NOW });
    expect(live.freshness.mode).toBe("LIVE");
    expect(live.results[0].values[0].display).toBe(4); // deleted profiles are not counted
    await pipeline.refreshDataMarts({ now: NOW, backfillDays: 7, martKey: "executive" });
    const mart = await engine.runAnalyticsQuery(v(...BASE), q, { now: NOW });
    expect(mart.freshness.mode).toBe("DAILY_MART");
    expect(mart.results[0].values[0].display).toBe(4);
    expect(mart.freshness.label).toMatch(/Daily metrics — updated/);
  });

  it("running the refresh again changes nothing, and a rebuild from source reproduces the same figures", async () => {
    seedApplicants();
    await pipeline.refreshDataMarts({ now: NOW, backfillDays: 7, martKey: "executive" });
    const snapshot = () => JSON.stringify(rows("analyticsDailyMetric").map((r) => [String(r.date), r.metricKey, r.dimensionKey, r.dimensionValue, String(r.value)]).sort());
    const first = snapshot();
    const count = rows("analyticsDailyMetric").length;
    await pipeline.refreshDataMarts({ now: NOW, backfillDays: 7, martKey: "executive" });
    expect(rows("analyticsDailyMetric").length).toBe(count);
    expect(snapshot()).toBe(first);
    // wipe the stored figures and rebuild them from the operational rows
    db.set("analyticsDailyMetric", []);
    const out = await pipeline.rebuildMetrics("admin-1", { martKey: "executive", fromDay: "2026-10-09", toDay: "2026-10-15" }, "verify rebuild", { now: NOW });
    expect(out.status).toBe("SUCCEEDED");
    expect(snapshot()).toBe(first);
    expect(audits.some((a) => a.action === "ANALYTICS_REBUILD")).toBe(true);
  });

  it("a rebuild needs a reason and cannot target a cohort metric (those are never stored)", async () => {
    await expect(pipeline.rebuildMetrics("a", { martKey: "executive", fromDay: "2026-10-01", toDay: "2026-10-02" }, "")).rejects.toMatchObject({ status: 422 });
    await expect(pipeline.rebuildMetrics("a", { metricKey: "funnel.verified", fromDay: "2026-10-01", toDay: "2026-10-02" }, "because")).rejects.toMatchObject({ status: 404 });
  });

  it("comparison shows 'Not available' instead of a percentage against zero", async () => {
    seedApplicants();
    const res = await engine.runAnalyticsQuery(v(...BASE), { metrics: ["applicants.new"], period: { preset: "TODAY" }, compare: "PREVIOUS_PERIOD" }, { now: NOW });
    expect(res.results[0].values[0].display).toBe(3);
    expect(res.results[0].previous?.[0].display).toBe(1);
    expect(res.results[0].changePct?.["ALL|"]).toBe(200);
    const none = await engine.runAnalyticsQuery(v(...BASE), { metrics: ["applicants.new"], period: { preset: "YESTERDAY" }, compare: "PREVIOUS_PERIOD" }, { now: NOW });
    expect(none.results[0].changePct?.["ALL|"]).toBeNull(); // the day before has no applicants
  });

  it("refuses a metric the viewer may not see, and logs the denial", async () => {
    await expect(engine.runAnalyticsQuery(v(...BASE), { metrics: ["finance.gross_revenue"], period: { preset: "LAST_7_DAYS" } }, { now: NOW })).rejects.toMatchObject({ status: 403 });
    expect(rows("analyticsAccessLog").some((r) => r.outcome === "DENIED" && r.resourceId === "finance.gross_revenue")).toBe(true);
    await expect(engine.runAnalyticsQuery(v(), { metrics: ["applicants.new"], period: { preset: "TODAY" } }, { now: NOW })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects anything that is not a closed query", async () => {
    for (const bad of [{ metrics: ["applicants.new"], period: { preset: "TODAY" }, sql: "select 1" }, { metrics: [], period: { preset: "TODAY" } }, { metrics: ["x"], period: { preset: "FOREVER" } }, "select * from Profile"])
      await expect(engine.runAnalyticsQuery(v(...BASE), bad, { now: NOW })).rejects.toBeTruthy();
  });

  it("money is reported per currency and never added across currencies", async () => {
    rows("payment").push({ id: "pay1", status: "PAID", paidAt: TODAY_10AM, currencyCode: "PKR", amountMinor: 100_000 });
    rows("payment").push({ id: "pay2", status: "PAID", paidAt: TODAY_10AM, currencyCode: "PKR", amountMinor: 50_001 });
    rows("payment").push({ id: "pay3", status: "PAID", paidAt: TODAY_10AM, currencyCode: "USD", amountMinor: 5_000 });
    rows("payment").push({ id: "pay4", status: "FAILED", paidAt: null, currencyCode: "PKR", amountMinor: 999_999 });
    const res = await engine.runAnalyticsQuery(v(...BASE, "analytics:finance:view"), { metrics: ["finance.gross_revenue"], period: { preset: "TODAY" } }, { now: NOW });
    const byCur = Object.fromEntries(res.results[0].values.map((x) => [x.currency, x.display]));
    expect(byCur).toEqual({ PKR: 150_001, USD: 5_000 });
    expect(Number.isInteger(byCur.PKR)).toBe(true);
  });

  it("hides small groups in a breakdown, and the next-smallest so a total cannot reveal them", async () => {
    for (let i = 0; i < 2; i++) rows("lead").push({ id: `l1-${i}`, source: "WHATSAPP", createdAt: TODAY_10AM });
    for (let i = 0; i < 9; i++) rows("lead").push({ id: `l2-${i}`, source: "WEBSITE", createdAt: TODAY_10AM });
    for (let i = 0; i < 30; i++) rows("lead").push({ id: `l3-${i}`, source: "REFERRAL", createdAt: TODAY_10AM });
    const res = await engine.runAnalyticsQuery(v(...BASE), { metrics: ["crm.leads"], period: { preset: "TODAY" }, dimension: "source" }, { now: NOW });
    const by = Object.fromEntries(res.results[0].values.map((x) => [x.dimensionValue, x]));
    expect(by.WHATSAPP.suppressed).toBe(true);
    expect(by.WEBSITE.suppressed).toBe(true);
    expect(by.REFERRAL.display).toBe(30);
    expect(by.WHATSAPP.display).toBeNull();
  });

  it("a suspended metric is refused even for an authorised viewer", async () => {
    rows("analyticsMetricDefinition").push({ id: "m1", key: "applicants.new", status: "SUSPENDED" });
    const cat = await import("./catalog-service");
    cat.clearCatalogCache();
    await expect(engine.runAnalyticsQuery(v(...BASE), { metrics: ["applicants.new"], period: { preset: "TODAY" } }, { now: NOW })).rejects.toMatchObject({ status: 409 });
  });
});

describe("reconciliation", () => {
  it("source, live calculation and stored figures agree — and a tampered figure shows a variance", async () => {
    seedApplicants();
    for (let i = 0; i < 4; i++) rows("lead").push({ id: `lead-${i}`, source: "WEBSITE", createdAt: YESTERDAY_10AM });
    rows("payment").push({ id: "pay1", status: "PAID", paidAt: YESTERDAY_10AM, currencyCode: "PKR", amountMinor: 70_000 });
    await pipeline.refreshDataMarts({ now: NOW, backfillDays: 7 });
    const ok = await recon.runReconciliation("admin-1", { now: NOW, days: 5 });
    expect(ok.variances).toBe(0);
    expect(ok.reconciled).toBeGreaterThan(5);
    const gross = ok.items.find((i) => i.metricKey === "finance.gross_revenue" && i.currency === "PKR");
    expect(gross).toMatchObject({ operational: 70_000, analytics: 70_000, status: "RECONCILED" });

    const stored = rows("analyticsDailyMetric").find((r) => r.metricKey === "applicants.new" && r.dimensionKey === "ALL" && (r.date as Date).toISOString().startsWith("2026-10-14"));
    expect(stored).toBeTruthy();
    stored!.value = BigInt(99);
    const bad = await recon.runReconciliation("admin-1", { now: NOW, days: 5 });
    expect(bad.variances).toBeGreaterThanOrEqual(1);
    expect(bad.items.find((i) => i.metricKey === "applicants.new")?.status).toBe("VARIANCE");
    expect((await recon.latestReconciliation())?.variances).toBeGreaterThanOrEqual(1);
  });
});

describe("data quality", () => {
  it("opens an issue once, re-finds it without duplicating, resolves it when fixed, and an ignore needs a reason", async () => {
    rows("profile").push({ id: "p-future", createdAt: new Date("2030-01-01T00:00:00Z"), softDeleted: false });
    const first = await quality.runDataQualityChecks(NOW);
    expect(first.byCheck.FUTURE_DATED_RECORD).toBe(1);
    const future = () => rows("analyticsDataQualityIssue").filter((r) => r.checkKey === "FUTURE_DATED_RECORD");
    expect(first.byCheck.MART_STALE).toBe(1); // no mart has run yet, so the freshness check correctly reports it
    expect(future()).toHaveLength(1);
    await quality.runDataQualityChecks(NOW);
    expect(future()).toHaveLength(1); // found again: the same issue, not a duplicate
    expect(rows("analyticsDataQualityIssue")).toHaveLength(2);
    const issue = future()[0];
    expect(issue.subjectRef).toBe("p-future");
    await expect(quality.setIssueStatus({ id: "a", permissions: [] }, issue.id as string, "IGNORED_WITH_REASON", "")).rejects.toMatchObject({ status: 422 });
    await quality.setIssueStatus({ id: "a", permissions: [] }, issue.id as string, "IGNORED_WITH_REASON", "Imported test record");
    expect(future()[0]).toMatchObject({ status: "IGNORED_WITH_REASON", ignoreReason: "Imported test record" });
    await quality.runDataQualityChecks(NOW);
    expect(future()[0].status).toBe("IGNORED_WITH_REASON"); // an ignored issue stays ignored
    // an open issue resolves itself once the data is fixed
    future()[0].status = "OPEN";
    db.set("profile", []);
    const after = await quality.runDataQualityChecks(NOW);
    expect(after.autoResolved).toBeGreaterThanOrEqual(1);
    expect(future()[0].status).toBe("RESOLVED");
  });
});

describe("alerts", () => {
  beforeEach(() => {
    addAdmins({ id: "recipient-1", role: "SUPPORT_MANAGER" });
    permsByAdmin.set("SUPPORT_MANAGER", ["analytics:view", "cases:view"]);
  });
  const seedCases = (n: number, at = YESTERDAY_10AM) => { for (let i = 0; i < n; i++) rows("case").push({ id: `c-${idc++}`, createdAt: at, category: "OTHER", priority: "NORMAL", type: "SUPPORT" }); };
  const actor = v("analytics:view", "cases:view", "analytics:alerts:manage");

  it("fires once when the threshold is crossed on a large enough sample, then stays quiet", async () => {
    seedCases(8);
    await alerts.createAlertRule(actor, { name: "Case spike", metricKey: "support.opened", operator: "GT", threshold: 5, minSample: 5, recipientAdminIds: ["recipient-1"], cooldownMinutes: 120 });
    const a = await alerts.evaluateAlertRules(NOW);
    expect(a.fired).toBe(1);
    expect(sent.filter((s) => s.type === "ANALYTICS_ALERT")).toHaveLength(1);
    expect(sent[0]).toMatchObject({ adminId: "recipient-1" });
    const b = await alerts.evaluateAlertRules(new Date(NOW.getTime() + 3_600_000));
    expect(b.fired).toBe(0);
    expect(b.skippedOpen).toBe(1);
  });

  it("does not fire on a tiny sample, and auto-resolves when the number falls back", async () => {
    seedCases(8);
    await alerts.createAlertRule(actor, { name: "Needs 50", metricKey: "support.opened", operator: "GT", threshold: 5, minSample: 50, recipientAdminIds: [] });
    const small = await alerts.evaluateAlertRules(NOW);
    expect(small.fired).toBe(0);
    expect(small.skippedSmallSample).toBe(1);
    rows("analyticsAlertRule")[0].minSample = 5;
    expect((await alerts.evaluateAlertRules(NOW)).fired).toBe(1);
    db.set("case", []);
    const cleared = await alerts.evaluateAlertRules(new Date(NOW.getTime() + 86_400_000));
    expect(cleared.autoResolved).toBe(1);
    expect(rows("analyticsAlertEvent")[0].status).toBe("RESOLVED");
  });

  it("respects the cooldown after an alert is resolved", async () => {
    seedCases(8);
    await alerts.createAlertRule(actor, { name: "Cooldown", metricKey: "support.opened", operator: "GT", threshold: 5, minSample: 5, recipientAdminIds: [], cooldownMinutes: 24 * 60 });
    expect((await alerts.evaluateAlertRules(NOW)).fired).toBe(1);
    rows("analyticsAlertEvent")[0].status = "RESOLVED";
    const again = await alerts.evaluateAlertRules(new Date(NOW.getTime() + 3_600_000));
    expect(again.fired).toBe(0);
    expect(again.skippedCooldown).toBe(1);
  });

  it("only people who may see the metric can be named as recipients, and you cannot alert on a metric you cannot see", async () => {
    addAdmins({ id: "nosee", role: "NOBODY" });
    permsByAdmin.set("NOBODY", []);
    seedCases(1);
    const rule = await alerts.createAlertRule(actor, { name: "Recipients", metricKey: "support.opened", operator: "GT", threshold: 1, recipientAdminIds: ["recipient-1", "nosee", "ghost"] });
    expect(rule.recipientAdminIds).toEqual(["recipient-1"]);
    await expect(alerts.createAlertRule(v("analytics:view"), { name: "No access", metricKey: "finance.gross_revenue", operator: "GT", threshold: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it("evaluates nothing while the alerts switch is off", async () => {
    flags.delete("analytics.alerts.enabled");
    expect((await alerts.evaluateAlertRules(NOW)).evaluated).toBe(0);
  });
});

describe("reports, scheduling and exports", () => {
  const OWNER = ["analytics:view", "analytics:cross_domain:view", "analytics:reports:view", "analytics:reports:create", "analytics:reports:run", "analytics:reports:export", "analytics:reports:schedule", "analytics:reports:share", "analytics:metrics:view"];
  const definition = { dataset: "crm", query: { metrics: ["crm.leads"], period: { preset: "LAST_30_DAYS" }, dimension: "source" } };

  async function owner() {
    addAdmins({ id: "owner-1", role: "OWNER_ROLE" });
    permsByAdmin.set("OWNER_ROLE", OWNER);
    return (await loadViewer("owner-1"))!;
  }

  it("a recipient who loses access stops receiving the report, and the schedule pauses itself when nobody is left", async () => {
    const o = await owner();
    addAdmins({ id: "good", role: "GOOD" }, { id: "weak", role: "WEAK" });
    permsByAdmin.set("GOOD", ["analytics:view", "analytics:cross_domain:view", "analytics:reports:view"]);
    permsByAdmin.set("WEAK", ["analytics:dashboard:view"]);
    const report = await reportsSvc.createReport(o, { name: "Lead sources", definition });
    expect(report.code).toMatch(/^LPP-REPORT-/);
    const sched = await scheduler.createSchedule(o, report.id, { frequency: "WEEKLY", dayOfWeek: 1, hourLocal: 8, recipientAdminIds: ["good", "weak", "missing"] });
    expect(sched.rejected.sort()).toEqual(["missing", "weak"]);
    expect(sched.schedule.recipientAdminIds).toEqual(["good"]);

    rows("analyticsReportSchedule")[0].nextRunAt = new Date(NOW.getTime() - 1000);
    const run1 = await scheduler.runDueSchedules(NOW);
    expect(run1).toMatchObject({ delivered: 1, paused: 0 });
    expect(sent.filter((s) => s.type === "ANALYTICS_REPORT_READY")).toEqual([{ adminId: "good", type: "ANALYTICS_REPORT_READY", data: {} }]);
    expect(sent.some((s) => JSON.stringify(s).includes("crm.leads"))).toBe(false); // the notice carries no data

    permsByAdmin.set("GOOD", ["analytics:dashboard:view"]); // access removed
    rows("analyticsReportSchedule")[0].nextRunAt = new Date(NOW.getTime() - 1000);
    const run2 = await scheduler.runDueSchedules(new Date(NOW.getTime() + 86_400_000));
    expect(run2).toMatchObject({ delivered: 0, skipped: 1, paused: 1 });
    expect(rows("analyticsReportSchedule")[0]).toMatchObject({ status: "PAUSED" });
    expect(rows("analyticsReportDelivery").map((d) => d.outcome)).toEqual(["SENT", "SKIPPED_NO_ACCESS"]);
    expect(sent.filter((s) => s.type === "ANALYTICS_REPORT_READY")).toHaveLength(1);
  });

  it("a deactivated recipient is skipped, and delivery is off while the scheduled-reports switch is off", async () => {
    const o = await owner();
    addAdmins({ id: "gone", role: "GOOD" });
    permsByAdmin.set("GOOD", ["analytics:view", "analytics:cross_domain:view", "analytics:reports:view"]);
    const report = await reportsSvc.createReport(o, { name: "Lead sources", definition });
    await scheduler.createSchedule(o, report.id, { frequency: "DAILY", recipientAdminIds: ["gone"] });
    rows("analyticsReportSchedule")[0].nextRunAt = new Date(NOW.getTime() - 1000);
    flags.delete("analytics.scheduled_reports.enabled");
    expect((await scheduler.runDueSchedules(NOW)).due).toBe(0);
    flags.add("analytics.scheduled_reports.enabled");
    rows("adminUser").find((u) => u.id === "gone")!.active = false;
    const r = await scheduler.runDueSchedules(NOW);
    expect(r.delivered).toBe(0);
    expect(rows("analyticsReportDelivery")[0].outcome).toBe("SKIPPED_INACTIVE");
  });

  it("a report shared with others runs as THEM: a viewer without the metric cannot read it, and a hidden report looks missing", async () => {
    const o = await owner();
    const report = await reportsSvc.createReport(o, { name: "Org report", definition, visibility: "ORGANIZATION" });
    addAdmins({ id: "stranger", role: "STRANGER" }, { id: "peer", role: "PEER" });
    permsByAdmin.set("STRANGER", ["analytics:reports:view"]); // can open reports, but has no analytics access to the CRM metric
    permsByAdmin.set("PEER", ["analytics:view", "analytics:cross_domain:view", "analytics:reports:view", "analytics:reports:run"]);
    const stranger = (await loadViewer("stranger"))!;
    await expect(reportsSvc.runReport(stranger, { id: report.id }, { now: NOW })).rejects.toMatchObject({ status: 403 });
    const peer = (await loadViewer("peer"))!;
    expect((await reportsSvc.runReport(peer, { id: report.id }, { now: NOW })).table.columns.length).toBeGreaterThan(1);
    // a private report is invisible to others (404, not 403)
    const priv = await reportsSvc.createReport(o, { name: "Private", definition });
    await expect(reportsSvc.getReport(peer, priv.id)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot share a report that contains data the sharer cannot see", async () => {
    const o = await owner();
    const report = await reportsSvc.createReport(o, { name: "Mine", definition });
    permsByAdmin.set("OWNER_ROLE", ["analytics:view", "analytics:reports:view", "analytics:reports:create", "analytics:reports:share"]); // lost cross-domain access
    const lessOwner = (await loadViewer("owner-1"))!;
    await expect(reportsSvc.updateReport(lessOwner, report.id, { visibility: "ORGANIZATION" })).rejects.toMatchObject({ status: 403 });
  });

  it("exports neutralise spreadsheet formulas, carry definitions and are audited; without export permission nothing is produced", async () => {
    const o = await owner();
    for (let i = 0; i < 9; i++) rows("lead").push({ id: `x-${i}`, source: "=HYPERLINK(\"http://evil\")", createdAt: new Date(NOW.getTime() - 86_400_000) });
    for (let i = 0; i < 9; i++) rows("lead").push({ id: `y-${i}`, source: "WEBSITE", createdAt: new Date(NOW.getTime() - 86_400_000) });
    const file = await reportsSvc.exportReport(o, { definition }, "csv", { now: NOW });
    const csv = String(file.body);
    expect(file.contentType).toMatch(/text\/csv/);
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).not.toMatch(/(^|,)"=HYPERLINK/m);
    expect(csv).toMatch(/Period: /);
    expect(csv).toMatch(/\[crm\.leads v1\]/);
    expect(audits.filter((a) => a.action === "ANALYTICS_REPORT_EXPORTED")).toHaveLength(1);
    expect(rows("analyticsAccessLog").some((r) => r.action === "EXPORT")).toBe(true);
    permsByAdmin.set("OWNER_ROLE", OWNER.filter((p) => p !== "analytics:reports:export"));
    const noExport = (await loadViewer("owner-1"))!;
    await expect(reportsSvc.exportReport(noExport, { definition }, "csv", { now: NOW })).rejects.toMatchObject({ status: 403 });
    expect(audits.filter((a) => a.action === "ANALYTICS_REPORT_EXPORTED")).toHaveLength(1);
  });
});

describe("dashboards never widen anyone's access", () => {
  const widget = (metrics: string[], over: Record<string, unknown> = {}) => [{ id: "w1", type: "KPI", title: "A widget", metrics, ...over }];

  it("a widget the owner cannot see cannot be saved; shared widgets are re-checked per viewer", async () => {
    addAdmins({ id: "owner-1", role: "OWNER" }, { id: "viewer-1", role: "VIEW" }, { id: "finance-1", role: "FIN" });
    permsByAdmin.set("OWNER", ["analytics:view", "analytics:dashboard:view", "analytics:dashboard:create", "analytics:dashboard:share", "analytics:cross_domain:view", "analytics:finance:view"]);
    permsByAdmin.set("VIEW", ["analytics:dashboard:view"]);
    permsByAdmin.set("FIN", ["analytics:view", "analytics:dashboard:view"]);
    const owner = (await loadViewer("owner-1"))!;
    const viewer = (await loadViewer("viewer-1"))!;
    const noFinance = { id: "x", permissions: ["analytics:view", "analytics:dashboard:create"] };
    await expect(dashSvc.createDashboard(noFinance, { name: "Bad", widgets: widget(["finance.gross_revenue"]) })).rejects.toMatchObject({ status: 403 });

    const d = await dashSvc.createDashboard(owner, { name: "Mixed", widgets: [...widget(["applicants.total"]), { id: "w2", type: "KPI", title: "Revenue today", metrics: ["finance.gross_revenue"] }] });
    expect(d.code).toMatch(/^LPP-DASH-/);
    await expect(dashSvc.renderDashboard(viewer, d.id, { now: NOW })).rejects.toMatchObject({ status: 404 }); // not shared yet: looks missing
    await dashSvc.shareDashboard(owner, d.id, "ORGANIZATION");
    const shown = await dashSvc.renderDashboard(viewer, d.id, { now: NOW });
    expect(shown.widgets.find((w) => w.id === "w1")?.available).toBe(true);
    expect(shown.widgets.find((w) => w.id === "w2")).toMatchObject({ available: false, reason: "Not available to you." });
    expect(JSON.stringify(shown)).not.toMatch(/gross revenue/i);
    // the owner losing the finance permission means they can no longer re-share it either
    permsByAdmin.set("OWNER", ["analytics:view", "analytics:dashboard:view", "analytics:dashboard:create", "analytics:dashboard:share", "analytics:cross_domain:view"]);
    const weaker = (await loadViewer("owner-1"))!;
    await expect(dashSvc.shareDashboard(weaker, d.id, "ORGANIZATION")).rejects.toMatchObject({ status: 403 });
  });

  it("only the owner may change or share a dashboard", async () => {
    addAdmins({ id: "owner-1", role: "OWNER" }, { id: "other-1", role: "OTHER" });
    permsByAdmin.set("OWNER", ["analytics:view", "analytics:dashboard:view", "analytics:dashboard:create", "analytics:dashboard:share"]);
    permsByAdmin.set("OTHER", ["analytics:view", "analytics:dashboard:view", "analytics:dashboard:edit", "analytics:dashboard:share"]);
    const owner = (await loadViewer("owner-1"))!;
    const other = (await loadViewer("other-1"))!;
    const d = await dashSvc.createDashboard(owner, { name: "Mine", widgets: widget(["applicants.total"]) });
    await expect(dashSvc.updateDashboard(other, d.id, { name: "Hijacked" })).rejects.toMatchObject({ status: 403 });
    await expect(dashSvc.shareDashboard(other, d.id, "ORGANIZATION")).rejects.toMatchObject({ status: 403 });
  });
});

describe("KPIs", () => {
  it("a formula change makes a new version, goes back to draft, and the author cannot approve it", async () => {
    const kpiSvc = await import("./kpi-service");
    const a = { id: "author", permissions: ["analytics:kpi:create", "analytics:kpi:manage"] };
    const b = { id: "reviewer", permissions: ["analytics:kpi:manage"] };
    const k = await kpiSvc.createKpi(a, { key: "TEST_RATE", name: "Test rate", description: "A test", category: "applicants", unit: "PERCENT", formula: { kind: "RATIO", numerator: "funnel.verified", denominator: "funnel.submitted", scale: 100 } });
    expect(k.code).toMatch(/^LPP-KPI-/);
    await kpiSvc.advanceKpi(a, k.id, "SUBMIT", "ready");
    await expect(kpiSvc.advanceKpi(a, k.id, "APPROVE", "self approval")).rejects.toMatchObject({ status: 403 });
    await kpiSvc.advanceKpi(b, k.id, "APPROVE", "looks right to me");
    await kpiSvc.advanceKpi(b, k.id, "ACTIVATE", "go live now");
    expect(rows("analyticsKpi")[0].status).toBe("ACTIVE");
    await kpiSvc.newKpiVersion(a, k.id, { formula: { kind: "RATIO", numerator: "funnel.verified", denominator: "funnel.registered", scale: 100 }, changeSummary: "use registered as the base" });
    expect(rows("analyticsKpi")[0]).toMatchObject({ currentVersion: 2, status: "DRAFT" });
    expect(rows("analyticsKpiVersion").map((r) => r.version)).toEqual([1, 2]); // version 1 is still there, unchanged
    await expect(kpiSvc.createKpi(a, { key: "bad key", name: "x", description: "y", category: "a", unit: "COUNT", formula: { kind: "METRIC", metric: "applicants.new" } })).rejects.toMatchObject({ status: 422 });
    await expect(kpiSvc.createKpi(a, { key: "SQL_KPI", name: "Sql", description: "desc", category: "a", unit: "COUNT", formula: "select 1" })).rejects.toMatchObject({ status: 422 });
  });
});
