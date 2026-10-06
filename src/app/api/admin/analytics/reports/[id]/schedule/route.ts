import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createSchedule, listSchedules, setScheduleStatus } from "@/lib/analytics/report-scheduler";
import { HttpError } from "@/lib/http-error";
import { assertEnabled, dbViewerFor } from "@/lib/analytics/route-helpers";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

// Recipients are re-checked at creation AND before every delivery; one who loses access is dropped and, with none left, the schedule pauses.
export async function GET() {
  try {
    const admin = await requireAdmin("analytics:reports:schedule");
    await assertEnabled("analytics.reports.enabled", "analytics.scheduled_reports.enabled");
    return NextResponse.json({ items: await listSchedules(admin) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:reports:schedule");
    await assertEnabled("analytics.reports.enabled", "analytics.scheduled_reports.enabled");
    const { id } = await params;
    const b = await readBody(req);
    if (b.scheduleId) return NextResponse.json({ id: (await setScheduleStatus(admin, String(b.scheduleId), b.status === "ACTIVE" ? "ACTIVE" : b.status === "ARCHIVED" ? "ARCHIVED" : "PAUSED")).id });
    const ids = Array.isArray(b.recipientAdminIds) ? (b.recipientAdminIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!ids.length) throw new HttpError(400, "Choose at least one recipient.");
    const out = await createSchedule(await dbViewerFor(admin.id), id, { frequency: str(b, "frequency", { required: true, max: 10 }), dayOfWeek: typeof b.dayOfWeek === "number" ? b.dayOfWeek : null, dayOfMonth: typeof b.dayOfMonth === "number" ? b.dayOfMonth : null, hourLocal: typeof b.hourLocal === "number" ? b.hourLocal : 8, recipientAdminIds: ids });
    return NextResponse.json({ id: out.schedule.id, nextRunAt: out.schedule.nextRunAt, droppedRecipients: out.rejected.length }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
