import type { ColumnDef } from "@/lib/reports/columns";

// Generalizes the pre-existing hand-rolled CSV builder from
// src/app/api/admin/reports/export/route.ts (manual quote-escaping, no
// library) to accept an arbitrary column/row set.
function escapeCsvCell(value: unknown): string {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildCsv(columns: ColumnDef[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(row[c.key])).join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}
