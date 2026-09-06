"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Select, Checkbox } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ReportFilterBar, EMPTY_REPORT_FILTERS, type ReportFilterState } from "@/components/admin/report-filter-bar";
import { DateRangePicker } from "@/components/admin/date-range-picker";
import type { DateRangePreset } from "@/lib/reports/types";

type DataSource = "Profiles" | "Verification" | "Matches" | "Proposals" | "Meetings" | "Communications" | "FollowUps";
const DATA_SOURCES: DataSource[] = ["Profiles", "Verification", "Matches", "Proposals", "Meetings", "Communications", "FollowUps"];

interface ColumnDef {
  key: string;
  label: string;
  sensitive: boolean;
}
interface Definition {
  columns: ColumnDef[];
  filterableFields: string[];
  groupByFields: string[];
  sortByFields: string[];
}

export default function CustomReportPage() {
  const { show } = useToast();
  const [definitions, setDefinitions] = useState<Record<DataSource, Definition> | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>("Profiles");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS);
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [admins, setAdmins] = useState<{ id: string; name: string }[]>([]);
  const [result, setResult] = useState<{ columns: ColumnDef[]; rows: Record<string, unknown>[]; grouped?: { label: string; count: number }[]; recordCount: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pendingExport, setPendingExport] = useState<"CSV" | "EXCEL" | "PDF" | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/definitions").then((r) => r.json()).then((j) => setDefinitions(j.definitions));
    fetch("/api/admin/reports/admins").then((r) => r.json()).then((j) => setAdmins(j.items ?? [])).catch(() => {});
  }, []);

  const definition = definitions?.[dataSource];
  const hasSensitiveSelected = definition?.columns.some((c) => selectedColumns.includes(c.key) && c.sensitive) ?? false;

  const filtersPayload = useMemo(() => {
    const p: Record<string, string> = { preset };
    if (preset === "custom") {
      if (customFrom) p.from = customFrom;
      if (customTo) p.to = customTo;
    }
    Object.entries(filters).forEach(([k, v]) => {
      if (v) p[k] = v;
    });
    return p;
  }, [filters, preset, customFrom, customTo]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/reports/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSource, columns: selectedColumns, filters: filtersPayload, groupBy: groupBy || undefined, sortBy: sortBy || undefined }),
      });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      show("Could not generate the report.", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function runExport(format: "CSV" | "EXCEL" | "PDF") {
    try {
      const res = await fetch("/api/admin/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSource, columns: selectedColumns, filters: filtersPayload, format, groupBy: groupBy || undefined, sortBy: sortBy || undefined }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dataSource.toLowerCase()}-report.${format === "CSV" ? "csv" : format === "EXCEL" ? "xlsx" : "pdf"}`;
      a.click();
      URL.revokeObjectURL(url);
      show("Export ready.", "success");
    } catch {
      show("Export failed. Please try again.", "error");
    } finally {
      setPendingExport(null);
    }
  }

  function exportClicked(format: "CSV" | "EXCEL" | "PDF") {
    if (hasSensitiveSelected) setPendingExport(format);
    else runExport(format);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className={buttonClass({ variant: "outline", size: "sm" })}>
          <ArrowLeft className="h-4 w-4" /> Back to Reports
        </Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">Create Custom Report</h1>
          <p className="text-sm text-muted">Pick a data source, columns, filters, grouping, and sorting.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <Select
          value={dataSource}
          onChange={(e) => {
            setDataSource(e.target.value as DataSource);
            setSelectedColumns([]);
            setGroupBy("");
            setSortBy("");
            setResult(null);
          }}
          className="w-auto"
        >
          {DATA_SOURCES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
      </div>

      {definition && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="mb-3 text-sm font-medium">Columns</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {definition.columns.map((c) => (
              <Checkbox
                key={c.key}
                label={c.sensitive ? `${c.label} 🔒` : c.label}
                checked={selectedColumns.includes(c.key)}
                onChange={(e) =>
                  setSelectedColumns((prev) => (e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)))
                }
              />
            ))}
          </div>
        </div>
      )}

      <DateRangePicker preset={preset} from={customFrom} to={customTo} onChange={(p, f, t) => { setPreset(p); setCustomFrom(f); setCustomTo(t); }} />
      <ReportFilterBar filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_REPORT_FILTERS)} adminOptions={admins} />

      {definition && (
        <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <p className="mb-1 text-xs text-muted">Group By</p>
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="w-auto">
              <option value="">None</option>
              {definition.groupByFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted">Sort By</p>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-auto">
              <option value="">Default</option>
              {definition.sortByFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={generate} disabled={generating || selectedColumns.length === 0}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate Report"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{result.recordCount} records</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportClicked("CSV")}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportClicked("EXCEL")}>
                <Download className="h-3.5 w-3.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportClicked("PDF")}>
                <Download className="h-3.5 w-3.5" /> PDF
              </Button>
            </div>
          </div>

          {result.grouped ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="pb-2">Group</th><th className="pb-2 text-right">Count</th></tr>
              </thead>
              <tbody>
                {result.grouped.map((g) => (
                  <tr key={g.label} className="border-t border-border">
                    <td className="py-2">{g.label}</td>
                    <td className="py-2 text-right font-medium">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} className="pb-2 pr-4">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {result.columns.map((c) => (
                        <td key={c.key} className="py-2 pr-4">{String(row[c.key] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 100 && <p className="mt-2 text-xs text-muted">Showing first 100 of {result.rows.length} rows — export for the full set.</p>}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingExport != null}
        title="Export includes sensitive data"
        description="This export contains fields (mobile, email, income, or other private information) that only your role can view. Continue?"
        confirmLabel="Export Anyway"
        danger
        onConfirm={() => pendingExport && runExport(pendingExport)}
        onCancel={() => setPendingExport(null)}
      />
    </div>
  );
}
