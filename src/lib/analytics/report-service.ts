import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { formatMoney } from "@/lib/finance/money";
import { analyticsAudit, logAnalyticsAccess } from "@/lib/analytics/audit";
import { dimensionAccessible, isSensitiveMetric, metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { runAnalyticsQuery, querySchema, type QueryResult } from "@/lib/analytics/query";
import { buildCsvSafe } from "@/lib/marketing/csv";
import { buildExcelBuffer } from "@/lib/reports/export/excel";
import { buildPdfBuffer } from "@/lib/reports/export/pdf";
import type { ColumnDef } from "@/lib/reports/columns";
import type { DbViewer } from "@/lib/analytics/viewers";
import type { AnalyticsShareScope } from "@prisma/client";

// STEP 31 — saved reports and exports. A report is a CLOSED definition (dataset + catalog metrics + one allow-listed dimension +
// a period) — it can never contain SQL, a table name or a column name. Running a report always runs it AS THE PERSON RUNNING IT:
// the owner's access never carries over, so a shared report cannot show anyone more than they could see themselves. Exports are
// built from the same result, are formula-safe, carry the definitions and freshness, and are audited.

export const REPORT_DATASETS = ["applicants", "crm", "marketing", "matching", "proposals", "meetings", "verification", "support", "membership", "finance", "engagement", "referrals", "workload"] as const;
export type ReportDataset = (typeof REPORT_DATASETS)[number];

const DATASET_PREFIXES: Record<ReportDataset, string[]> = {
  applicants: ["applicants.", "funnel.", "outcomes."], crm: ["crm."], marketing: ["marketing."], matching: ["matching."], proposals: ["proposals.", "outcomes."], meetings: ["meetings."],
  verification: ["verification.", "identity.", "applicants.verifications_completed"], support: ["support."], membership: ["membership."], finance: ["finance."], engagement: ["engagement."],
  referrals: ["engagement.referrals", "membership.referral"], workload: ["tasks.", "followups.", "crm.assignment"],
};

export const reportDefinitionSchema = z.object({
  dataset: z.enum(REPORT_DATASETS),
  query: querySchema,
  sort: z.object({ by: z.string().max(80), dir: z.enum(["asc", "desc"]) }).strict().optional(),
}).strict();
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export function validateReportDefinition(input: unknown, owner: Viewer): ReportDefinition {
  const parsed = reportDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, "Invalid report definition.");
  const def = parsed.data;
  const dim = def.query.dimension ?? "ALL";
  for (const key of def.query.metrics) {
    const m = getMetric(key);
    if (!m) throw new HttpError(422, `Unknown metric: ${key.slice(0, 60)}`);
    if (!DATASET_PREFIXES[def.dataset].some((p) => key.startsWith(p))) throw new HttpError(422, `${m.name} does not belong to the ${def.dataset} dataset.`);
    if (!metricAccessible(owner, m)) throw new HttpError(403, `You cannot use ${m.name} in a report because you do not have access to it.`);
    if (dim !== "ALL" && !dimensionAccessible(owner, m, dim)) throw new HttpError(422, `${m.name} cannot be broken down by ${dim.slice(0, 30)}.`);
  }
  return def;
}

// ---------------- result -> table ----------------
export interface ReportTable { title: string; columns: ColumnDef[]; rows: Record<string, unknown>[]; footnotes: string[] }

function unitSuffix(unit: string): string {
  return unit === "PERCENT" ? " (%)" : unit === "HOURS" ? " (hours)" : unit === "MINOR_MONEY" ? "" : "";
}

function cell(unit: string, display: number | null, currency: string, suppressed?: boolean): string | number {
  if (suppressed) return "Insufficient data for this breakdown.";
  if (display === null) return "Insufficient verified data";
  return unit === "MINOR_MONEY" ? formatMoney(display, currency || "PKR", 2) : display;
}

export function queryToTable(result: QueryResult, title: string, opts: { sort?: ReportDefinition["sort"] } = {}): ReportTable {
  const dimensional = result.dimension !== "ALL";
  const columns: ColumnDef[] = [];
  if (dimensional) columns.push({ key: "dimension", label: result.dimension.replace(/_/g, " "), sensitive: false });
  const anyCurrency = result.results.some((r) => r.values.some((v) => v.currency !== ""));
  if (anyCurrency) columns.push({ key: "currency", label: "Currency", sensitive: false });
  for (const r of result.results) {
    columns.push({ key: r.key, label: `${r.name}${unitSuffix(r.unit)}`, sensitive: false });
    if (result.comparison) columns.push({ key: `${r.key}__chg`, label: `${r.name} — change vs ${result.comparison.label} (%)`, sensitive: false });
  }
  const rowKeys = new Map<string, Record<string, unknown>>();
  for (const r of result.results) {
    for (const v of r.values) {
      const k = `${v.dimensionValue}|${v.currency}`;
      const row = rowKeys.get(k) ?? { ...(dimensional ? { dimension: v.dimensionValue } : {}), ...(anyCurrency ? { currency: v.currency } : {}) };
      row[r.key] = cell(r.unit, v.display, v.currency, v.suppressed);
      if (result.comparison) {
        const c = r.changePct?.[k];
        row[`${r.key}__chg`] = c === null || c === undefined ? "Not available" : c;
      }
      rowKeys.set(k, row);
    }
  }
  let rows = [...rowKeys.values()].slice(0, 5000);
  if (opts.sort) {
    const by = opts.sort.by;
    const dir = opts.sort.dir === "asc" ? 1 : -1;
    rows = rows.sort((a, b) => {
      const x = a[by];
      const y = b[by];
      return typeof x === "number" && typeof y === "number" ? (x - y) * dir : String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });
  }
  const footnotes = [
    `Period: ${result.period.label}${result.comparison ? `; compared with ${result.comparison.label}` : ""}`,
    `Data: ${result.freshness.label}`,
    ...result.results.map((r) => `${r.name} [${r.key} ${r.version}]: ${r.definition.formula} — source: ${r.definition.source}${r.definition.note ? ` — ${r.definition.note}` : ""}`),
    "Rates need a minimum sample and breakdowns hide groups that are too small to be anonymous. Percent change is shown only when there is a non-zero previous value.",
  ];
  return { title, columns, rows, footnotes };
}

// ---------------- saved reports ----------------
export async function createReport(owner: Viewer, input: { name: string; description?: string | null; definition: unknown; visibility?: AnalyticsShareScope; visibilityValue?: string }) {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) throw new HttpError(422, "A name of 3-120 characters is required.");
  const definition = validateReportDefinition(input.definition, owner);
  const visibility = input.visibility ?? "PRIVATE";
  if (visibility !== "PRIVATE" && !owner.permissions.includes("analytics:reports:share")) throw new HttpError(403, "You cannot share reports.");
  const code = await nextSequenceCode("REPORT");
  const row = await prisma.analyticsReport.create({
    data: { code, name, description: input.description?.trim().slice(0, 300) || null, ownerId: owner.id, visibility, visibilityValue: visibility === "TEAM" || visibility === "DEPARTMENT" ? (input.visibilityValue ?? "").slice(0, 60) : "", versions: { create: { version: 1, definition: definition as never, authorId: owner.id } } },
  });
  await analyticsAudit({ action: "ANALYTICS_REPORT_CHANGED", actorId: owner.id, resource: "report", resourceId: row.id, after: { code, dataset: definition.dataset, metrics: definition.query.metrics.length, visibility } });
  return row;
}

export async function updateReport(editor: Viewer, id: string, input: { name?: string; description?: string | null; definition?: unknown; visibility?: AnalyticsShareScope; visibilityValue?: string; status?: "ACTIVE" | "ARCHIVED" }) {
  const r = await prisma.analyticsReport.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Report not found.");
  if (r.ownerId !== editor.id) throw new HttpError(403, "Only the owner can change a report.");
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim().slice(0, 120);
  if (input.description !== undefined) data.description = input.description?.trim().slice(0, 300) || null;
  if (input.status) data.status = input.status;
  if (input.visibility) {
    if (input.visibility !== "PRIVATE" && !editor.permissions.includes("analytics:reports:share")) throw new HttpError(403, "You cannot share reports.");
    // sharing re-validates the definition against the SHARER's own access: you can never share what you cannot see
    const current = reportDefinitionSchema.parse((await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: id, version: r.currentVersion } } }))?.definition);
    validateReportDefinition(current, editor);
    data.visibility = input.visibility;
    data.visibilityValue = input.visibility === "TEAM" || input.visibility === "DEPARTMENT" ? (input.visibilityValue ?? "").slice(0, 60) : "";
  }
  if (input.definition !== undefined) {
    const def = validateReportDefinition(input.definition, editor);
    const version = r.currentVersion + 1;
    await prisma.analyticsReportVersion.create({ data: { reportId: id, version, definition: def as never, authorId: editor.id } });
    data.currentVersion = version;
  }
  const row = await prisma.analyticsReport.update({ where: { id }, data: data as never });
  await analyticsAudit({ action: "ANALYTICS_REPORT_CHANGED", actorId: editor.id, resource: "report", resourceId: id, after: { version: row.currentVersion, visibility: row.visibility, status: row.status } });
  return row;
}

export function canSeeReport(v: DbViewer, r: { ownerId: string; status: string; visibility: AnalyticsShareScope; visibilityValue: string }): boolean {
  if (r.ownerId === v.id) return true;
  if (r.status !== "ACTIVE" || !v.permissions.includes("analytics:reports:view")) return false;
  return r.visibility === "ORGANIZATION" || (r.visibility === "TEAM" && r.visibilityValue === v.role) || (r.visibility === "DEPARTMENT" && !!v.departmentId && r.visibilityValue === v.departmentId);
}

export async function listReports(v: DbViewer) {
  const rows = await prisma.analyticsReport.findMany({ orderBy: { updatedAt: "desc" }, take: 300, include: { schedules: { select: { id: true, frequency: true, status: true, nextRunAt: true } } } });
  return rows.filter((r) => canSeeReport(v, r)).map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, owner: r.ownerId === v.id, status: r.status, visibility: r.visibility, version: r.currentVersion, schedules: r.ownerId === v.id ? r.schedules : undefined, updatedAt: r.updatedAt }));
}

export async function getReport(v: DbViewer, id: string) {
  const r = await prisma.analyticsReport.findUnique({ where: { id } });
  if (!r || !canSeeReport(v, r)) throw new HttpError(404, "Report not found."); // hidden looks exactly like missing (no IDOR signal)
  const version = await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: id, version: r.currentVersion } } });
  return { report: r, definition: reportDefinitionSchema.parse(version?.definition) };
}

// Run a saved report (or an unsaved definition) as the viewer.
export async function runReport(v: DbViewer, source: { id: string } | { definition: unknown }, opts: { now?: Date } = {}) {
  let definition: ReportDefinition;
  let name = "Report";
  let id: string | null = null;
  if ("id" in source) {
    const got = await getReport(v, source.id);
    definition = got.definition;
    name = got.report.name;
    id = got.report.id;
  } else {
    definition = validateReportDefinition(source.definition, v);
  }
  const result = await runAnalyticsQuery(v, definition.query, { now: opts.now, skipAccessLog: true, resource: "report" });
  const table = queryToTable(result, name, { sort: definition.sort });
  await analyticsAudit({ action: "ANALYTICS_REPORT_RUN", actorId: v.id, resource: "report", resourceId: id ?? "adhoc", after: { dataset: definition.dataset, rows: table.rows.length } });
  await logAnalyticsAccess({ adminId: v.id, action: "RUN", resource: "report", resourceId: id, sensitive: result.results.some((r) => { const d = getMetric(r.key); return d ? isSensitiveMetric(d) : false; }) });
  return { name, definition, result, table };
}

// ---------------- export ----------------
export type ExportFormat = "csv" | "xlsx" | "pdf";
export interface ExportedFile { filename: string; contentType: string; body: Buffer | string }

export async function exportReport(v: DbViewer, source: { id: string } | { definition: unknown }, format: ExportFormat, opts: { now?: Date } = {}): Promise<ExportedFile> {
  if (!v.permissions.includes("analytics:reports:export")) throw new HttpError(403, "You cannot export reports.");
  if (!(["csv", "xlsx", "pdf"] as string[]).includes(format)) throw new HttpError(422, "Unknown export format.");
  const { name, definition, result, table } = await runReport(v, source, opts);
  const sensitive = result.results.some((r) => { const d = getMetric(r.key); return d ? isSensitiveMetric(d) : false; });
  const safeName = name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "report";
  const stamp = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const header = table.columns.map((c) => c.label);
  const rows = table.rows.map((r) => table.columns.map((c) => r[c.key]));
  let file: ExportedFile;
  if (format === "csv") {
    const csv = buildCsvSafe(header, rows) + "\r\n\r\n" + table.footnotes.map((f) => `"${f.replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join("\r\n");
    file = { filename: `${safeName}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: csv };
  } else {
    // spreadsheet-safe text cells for Excel (a text starting = + - @ is never treated as a formula)
    const safeRows = table.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^[=+\-@\t\r]/.test(val) ? `'${val}` : val])));
    const withNotes = [...safeRows, {}, ...table.footnotes.map((f) => ({ [table.columns[0]?.key ?? "note"]: f }))];
    file = format === "xlsx"
      ? { filename: `${safeName}-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await buildExcelBuffer(table.columns, withNotes, name) }
      : { filename: `${safeName}-${stamp}.pdf`, contentType: "application/pdf", body: await buildPdfBuffer(table.columns, withNotes, name) };
  }
  await analyticsAudit({ action: "ANALYTICS_REPORT_EXPORTED", actorId: v.id, resource: "report", resourceId: "id" in source ? source.id : "adhoc", after: { format, dataset: definition.dataset, rows: table.rows.length, sensitive } });
  await logAnalyticsAccess({ adminId: v.id, action: "EXPORT", resource: "report", resourceId: "id" in source ? source.id : null, sensitive, detail: { format, rows: table.rows.length } });
  return file;
}
