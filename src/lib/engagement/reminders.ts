import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { engagementAudit } from "@/lib/engagement/audit";
import { REMINDER_KINDS, type ReminderKind } from "@/lib/engagement/constants";
import type { EngagementReminder } from "@prisma/client";

// STEP 30 — reminder ledger (scheduleReminder / cancelReminder). A reminder is a row, so it is visible, cancellable and counted;
// the actual send happens in deliver.ts through the single preflight gate. Scheduling is idempotent: the same dedupKey (or the
// same profile + kind + reference + attempt number) can only ever create one row.

export interface ScheduleReminderInput {
  profileId: string;
  kind: ReminderKind;
  dueAt: Date;
  refType?: string | null;
  refId?: string | null;
  runId?: string | null;
  dedupKey?: string;
  actorId?: string | null;
}

export async function scheduleReminder(input: ScheduleReminderInput): Promise<{ reminder: EngagementReminder; created: boolean }> {
  if (!REMINDER_KINDS.includes(input.kind)) throw new HttpError(422, "Unknown reminder kind.");
  const ref = input.refId ?? null;
  const prior = await prisma.engagementReminder.count({ where: { profileId: input.profileId, kind: input.kind, refId: ref, state: { notIn: ["CANCELLED", "OPTED_OUT", "NOT_ELIGIBLE"] } } });
  const attempt = prior + 1;
  const dedupKey = input.dedupKey ?? `${input.profileId}:${input.kind}:${ref ?? "-"}:${attempt}`;
  try {
    const reminder = await prisma.engagementReminder.create({
      data: { profileId: input.profileId, kind: input.kind, state: "SCHEDULED", dueAt: input.dueAt, refType: input.refType ?? null, refId: ref, runId: input.runId ?? null, attempt, dedupKey },
    });
    await engagementAudit({ action: "ENGAGEMENT_REMINDER_SCHEDULED", actorId: input.actorId ?? null, targetProfileId: input.profileId, resource: "engagement_reminder", resourceId: reminder.id, after: { kind: input.kind, attempt, dueAt: input.dueAt.toISOString() } }).catch(() => undefined);
    return { reminder, created: true };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await prisma.engagementReminder.findUnique({ where: { dedupKey } });
      if (existing) return { reminder: existing, created: false };
    }
    throw error;
  }
}

export async function cancelReminder(id: string, reason: string, actorId: string | null): Promise<EngagementReminder> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const r = await prisma.engagementReminder.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Reminder not found.");
  if (!["SCHEDULED", "ELIGIBLE"].includes(r.state)) throw new HttpError(409, "Only a reminder that has not been sent can be cancelled.");
  const updated = await prisma.engagementReminder.update({ where: { id }, data: { state: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.slice(0, 120) } });
  await engagementAudit({ action: "ENGAGEMENT_REMINDER_CANCELLED", actorId, targetProfileId: r.profileId, resource: "engagement_reminder", resourceId: id, before: { state: r.state }, after: { state: "CANCELLED" }, reason });
  return updated;
}

export async function listReminders(filter: { profileId?: string; state?: string; take?: number; cursor?: string | null }) {
  const take = Math.min(Math.max(filter.take ?? 50, 1), 100);
  const rows = await prisma.engagementReminder.findMany({
    where: { ...(filter.profileId ? { profileId: filter.profileId } : {}), ...(filter.state ? { state: filter.state as never } : {}) },
    orderBy: { id: "desc" },
    take: take + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  return { items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null };
}
