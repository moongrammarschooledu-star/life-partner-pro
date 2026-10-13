import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertEnvironmentMatches } from "@/lib/platform/environment";
import { recordConfigChange } from "@/lib/platform/config-change";

// Production change freeze (STEP 36 §56). Starting and ending a freeze needs platform:change_freeze, a reason and a fresh password re-confirmation (checked by
// the route). Changes made while a freeze is active are decided by decideUnderFreeze() in freeze-rules.ts via assertConfigChangeAllowed() in guard.ts.

export async function getActiveFreeze(now: Date = new Date()) {
  return prisma.platformChangeFreeze.findFirst({
    where: { endedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
}

export async function listFreezes(limit = 20) {
  return prisma.platformChangeFreeze.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(50, limit) });
}

export async function startFreeze(admin: SessionAdmin, input: { reason: unknown; endsAt?: unknown; environment: unknown }) {
  const environment = assertEnvironmentMatches(input.environment);
  const reason = requireReason(input.reason);
  let endsAt: Date | null = null;
  if (input.endsAt !== undefined && input.endsAt !== null && input.endsAt !== "") {
    endsAt = new Date(String(input.endsAt));
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) throw new ApiError(400, "The end time must be in the future.");
    if (endsAt.getTime() - Date.now() > 30 * 24 * 3600 * 1000) throw new ApiError(400, "A freeze can last at most 30 days. End it and start another if it needs to continue.");
  }
  if (await getActiveFreeze()) throw new ApiError(409, "A change freeze is already active.");
  const row = await prisma.platformChangeFreeze.create({ data: { reason, endsAt, createdById: admin.id } });
  await recordConfigChange({ kind: "CHANGE_FREEZE", key: "production", before: { active: false }, after: { active: true, endsAt: endsAt?.toISOString() ?? null }, actor: admin, reason, environment });
  await writeAudit({ action: "PLATFORM_CHANGE_FREEZE_CHANGED", adminId: admin.id, meta: { change: "STARTED", freezeId: row.id, endsAt: endsAt?.toISOString() ?? null, reason } });
  return row;
}

export async function endFreeze(admin: SessionAdmin, input: { reason: unknown; environment: unknown }) {
  const environment = assertEnvironmentMatches(input.environment);
  const reason = requireReason(input.reason);
  const active = await getActiveFreeze();
  if (!active) throw new ApiError(409, "There is no active change freeze.");
  const claimed = await prisma.platformChangeFreeze.updateMany({ where: { id: active.id, endedAt: null }, data: { endedAt: new Date(), endedById: admin.id } });
  if (claimed.count !== 1) throw new ApiError(409, "The freeze was already ended.");
  await recordConfigChange({ kind: "CHANGE_FREEZE", key: "production", before: { active: true }, after: { active: false }, actor: admin, reason, environment });
  await writeAudit({ action: "PLATFORM_CHANGE_FREEZE_CHANGED", adminId: admin.id, meta: { change: "ENDED", freezeId: active.id, reason } });
}
