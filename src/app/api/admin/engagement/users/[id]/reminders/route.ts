import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { REMINDER_KINDS, type ReminderKind } from "@/lib/engagement/constants";
import { scheduleReminder } from "@/lib/engagement/reminders";
import { deliverReminder } from "@/lib/engagement/deliver";
import { HttpError } from "@/lib/http-error";
import { marketingError, readBody } from "@/lib/marketing/route-utils";

// Staff can schedule a reminder for an applicant they may access. It is only SCHEDULED here: the send happens through the same
// preflight gate as every other reminder (consent, preferences, suppression, limits, quiet hours), so staff cannot bypass it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:reminders:manage");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);
    const b = await readBody(req);
    const kind = b.kind as ReminderKind;
    if (!REMINDER_KINDS.includes(kind)) throw new HttpError(400, "Unknown reminder kind.");
    const dueAt = b.dueAt ? new Date(String(b.dueAt)) : new Date();
    if (Number.isNaN(dueAt.getTime())) throw new HttpError(400, "Invalid date.");
    const { reminder, created } = await scheduleReminder({ profileId: id, kind, dueAt, actorId: admin.id, dedupKey: `STAFF:${id}:${kind}:${dueAt.toISOString().slice(0, 13)}` });
    const outcome = created && dueAt <= new Date() ? await deliverReminder(reminder.id) : null;
    return NextResponse.json({ id: reminder.id, created, outcome }, { status: created ? 201 : 200 });
  } catch (error) {
    return marketingError(error);
  }
}
