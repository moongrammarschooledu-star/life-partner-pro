import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { hashDestination } from "@/lib/communications/suppression-hash";
import type { CommunicationSuppression, CommunicationSuppressionReason, NotificationChannel } from "@prisma/client";

// Suppression list. A suppression is never silently removed: adding, lifting and expiry are all recorded with who / why, and
// lifting keeps the row (status LIFTED + liftedBy + reason) so the history is always answerable.

export const SUPPRESSION_SCOPES = ["ALL", "MARKETING", "TRANSACTIONAL"] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

// Reasons a person may never quietly undo: a lift needs a manager-level permission and a longer written reason (checked by the route).
export const HARD_REASONS: CommunicationSuppressionReason[] = ["BOUNCE", "COMPLAINT", "PROVIDER_BLOCK", "JURISDICTION_RULE"];

export async function addSuppression(params: {
  channel: NotificationChannel;
  reason: CommunicationSuppressionReason;
  scope?: SuppressionScope;
  profileId?: string | null;
  familyMemberId?: string | null;
  destination?: string | null; // raw address: hashed here, never stored
  expiresAt?: Date | null;
  note?: string | null;
  actorId?: string | null;
}): Promise<CommunicationSuppression> {
  if (!params.profileId && !params.familyMemberId && !params.destination) throw new HttpError(422, "A suppression needs a profile, family member or address.");
  const scope = params.scope ?? "ALL";
  if (!SUPPRESSION_SCOPES.includes(scope)) throw new HttpError(422, "Invalid suppression scope.");
  const destinationHash = params.destination ? hashDestination(params.destination) : null;

  // Idempotent: an equivalent ACTIVE suppression is returned rather than duplicated.
  const existing = await prisma.communicationSuppression.findFirst({
    where: { channel: params.channel, scope, status: "ACTIVE", profileId: params.profileId ?? null, familyMemberId: params.familyMemberId ?? null, destinationHash },
  });
  if (existing) return existing;

  const row = await prisma.communicationSuppression.create({
    data: {
      profileId: params.profileId ?? null,
      familyMemberId: params.familyMemberId ?? null,
      channel: params.channel,
      destinationHash,
      scope,
      reason: params.reason,
      expiresAt: params.expiresAt ?? null,
      note: params.note?.slice(0, 500) ?? null,
      createdById: params.actorId ?? null,
    },
  });
  await writeAudit({
    action: "COMMUNICATION_SUPPRESSION_ADDED",
    adminId: params.actorId ?? null,
    targetProfileId: params.profileId ?? null,
    meta: { suppressionId: row.id, channel: params.channel, reason: params.reason, scope, automatic: !params.actorId },
  });
  return row;
}

export async function liftSuppression(id: string, actorId: string, reason: string): Promise<CommunicationSuppression> {
  const text = reason.trim();
  if (text.length < 5) throw new HttpError(422, "A reason is required to lift a suppression.");
  const row = await prisma.communicationSuppression.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Suppression not found.");
  if (row.status !== "ACTIVE") throw new HttpError(409, "This suppression is not active.");
  const updated = await prisma.communicationSuppression.update({ where: { id }, data: { status: "LIFTED", liftedAt: new Date(), liftedById: actorId, liftReason: text.slice(0, 500) } });
  await writeAudit({ action: "COMMUNICATION_SUPPRESSION_LIFTED", adminId: actorId, targetProfileId: row.profileId, meta: { suppressionId: id, channel: row.channel, reason: row.reason, liftReason: text.slice(0, 200) } });
  return updated;
}

// Expired rows are marked (not deleted) so the history stays intact.
export async function expireSuppressions(now = new Date()): Promise<number> {
  const result = await prisma.communicationSuppression.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return result.count;
}

export async function listSuppressions(filter: { status?: string; channel?: NotificationChannel; take?: number } = {}) {
  return prisma.communicationSuppression.findMany({
    where: { ...(filter.status ? { status: filter.status as never } : {}), ...(filter.channel ? { channel: filter.channel } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.take ?? 100, 200),
  });
}
