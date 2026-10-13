import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertEnvironmentMatches } from "@/lib/platform/environment";
import { recordConfigChange } from "@/lib/platform/config-change";
import { getActiveFreeze } from "@/lib/platform/freeze";
import { breakGlassActive, canReviewBreakGlass, clampBreakGlassMinutes } from "@/lib/platform/freeze-rules";

// Platform break-glass (STEP 36 §57): a time-limited, audited permission to change configuration DURING a change freeze. It needs platform:break_glass, a
// reason and a fresh password re-confirmation (checked by the route; the administrator also passed two-factor sign-in). It NEVER changes the administrator's
// role or permissions: the only thing it does is let assertConfigChangeAllowed() treat that one person as allowed while a freeze is active, until it expires or
// is ended. Every change made under it is audited and counted, and a DIFFERENT administrator must review it afterwards.
// (The older BreakGlassAccess table is a separate, record-level mechanism for viewing one contact or case; it is untouched.)

export async function activeBreakGlassFor(adminId: string, now: Date = new Date()) {
  const row = await prisma.platformBreakGlassEvent.findFirst({ where: { adminId, endedAt: null, expiresAt: { gt: now } }, orderBy: { grantedAt: "desc" } });
  return breakGlassActive(row, now) ? row : null;
}

export async function grantBreakGlass(admin: SessionAdmin, input: { reason: unknown; minutes?: unknown; environment: unknown }) {
  const environment = assertEnvironmentMatches(input.environment);
  const reason = requireReason(input.reason, 10);
  if (!(await getActiveFreeze())) throw new ApiError(409, "Break-glass access is only for changing configuration during a change freeze, and none is active.");
  if (await activeBreakGlassFor(admin.id)) throw new ApiError(409, "You already have active break-glass access.");
  const minutes = clampBreakGlassMinutes(input.minutes);
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const row = await prisma.platformBreakGlassEvent.create({ data: { adminId: admin.id, reason, expiresAt } });
  await recordConfigChange({ kind: "CHANGE_FREEZE", key: "break-glass", before: null, after: { adminId: admin.id, expiresAt: expiresAt.toISOString(), minutes }, actor: admin, reason, environment });
  await writeAudit({ action: "PLATFORM_BREAK_GLASS_GRANTED", adminId: admin.id, meta: { eventId: row.id, minutes, expiresAt: expiresAt.toISOString(), reason } });
  return row;
}

export async function endBreakGlass(admin: SessionAdmin) {
  const row = await activeBreakGlassFor(admin.id);
  if (!row) throw new ApiError(409, "You have no active break-glass access.");
  await prisma.platformBreakGlassEvent.update({ where: { id: row.id }, data: { endedAt: new Date() } });
  await writeAudit({ action: "PLATFORM_BREAK_GLASS_ENDED", adminId: admin.id, meta: { eventId: row.id, actions: row.actionsCount } });
}

/** Called by the change guard each time a freeze is passed with break-glass: counts the use and writes an enhanced audit row. */
export async function noteBreakGlassUse(eventId: string, adminId: string, what: { kind: string; key: string }) {
  await prisma.platformBreakGlassEvent.update({ where: { id: eventId }, data: { actionsCount: { increment: 1 } } });
  await writeAudit({ action: "PLATFORM_BREAK_GLASS_GRANTED", adminId, meta: { eventId, use: true, kind: what.kind, key: what.key } });
}

export async function reviewBreakGlass(admin: SessionAdmin, id: string, note: unknown) {
  const event = await prisma.platformBreakGlassEvent.findUnique({ where: { id } });
  if (!event) throw new ApiError(404, "Not found.");
  const verdict = canReviewBreakGlass(event, admin.id);
  if (!verdict.ok) throw new ApiError(verdict.error.startsWith("You cannot") ? 403 : 409, verdict.error);
  const reviewNote = requireReason(note);
  const claimed = await prisma.platformBreakGlassEvent.updateMany({ where: { id, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedById: admin.id, reviewNote } });
  if (claimed.count !== 1) throw new ApiError(409, "This break-glass use has already been reviewed.");
  await writeAudit({ action: "PLATFORM_BREAK_GLASS_REVIEWED", adminId: admin.id, meta: { eventId: id, accessBy: event.adminId, actions: event.actionsCount } });
}

export async function listBreakGlass(limit = 25) {
  return prisma.platformBreakGlassEvent.findMany({ orderBy: { grantedAt: "desc" }, take: Math.min(50, limit) });
}

/** Events that ended or expired and still await a review: the post-event review queue. */
export async function pendingBreakGlassReviews(now: Date = new Date()) {
  return prisma.platformBreakGlassEvent.findMany({ where: { reviewedAt: null, OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }] }, orderBy: { grantedAt: "asc" }, take: 50 });
}
