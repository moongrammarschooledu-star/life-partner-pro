// CSV building with spreadsheet-formula neutralisation. Existing exports in this app did not neutralise cells that start
// with = + - @ (or tab/CR), which Excel/Sheets execute as formulas; marketing exports contain externally-supplied text
// (names, free-text inquiries), so every cell is neutralised and quoted here.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export function buildCsvSafe(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
