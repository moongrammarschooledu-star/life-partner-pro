import ExcelJS from "exceljs";
import type { ColumnDef } from "@/lib/reports/columns";

export async function buildExcelBuffer(columns: ColumnDef[], rows: Record<string, unknown>[], sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Life Partner Pro";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name length limit
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(row);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
