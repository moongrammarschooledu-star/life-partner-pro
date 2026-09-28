import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { addSuppression, listSuppressions, SUPPRESSION_SCOPES } from "@/lib/communications/suppression-service";
import { CHANNELS, oneOf, optionalOneOf, readJson, str, takeParam } from "@/lib/communications/route-utils";

// The list never contains an address: rows hold a salted hash of the destination, so this endpoint returns none.
export async function GET(req: Request) {
  try {
    await requireAdmin("communications:view");
    const q = new URL(req.url).searchParams;
    const rows = await listSuppressions({ status: q.get("status") ?? undefined, channel: optionalOneOf(q.get("channel"), CHANNELS, "channel"), take: takeParam(q.get("take"), 100) });
    return NextResponse.json({
      items: rows.map((r) => ({ id: r.id, channel: r.channel, reason: r.reason, scope: r.scope, status: r.status, profileId: r.profileId, familyMemberId: r.familyMemberId, hasAddress: Boolean(r.destinationHash), expiresAt: r.expiresAt, note: r.note, createdAt: r.createdAt, liftedAt: r.liftedAt })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// A manual suppression is always tied to a profile (staff pick a person; the address is read server-side, never typed in).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:suppress");
    const body = await readJson(req);
    const profileId = str(body.profileId, "profileId", { max: 60 });
    const channel = oneOf(body.channel, CHANNELS, "channel");
    const contact = await prisma.contactInfo.findUnique({ where: { profileId }, select: { mobileNumber: true, whatsappNumber: true, email: true } });
    if (!contact) throw new ApiError(404, "Profile not found.");
    const destination = channel === "EMAIL" ? contact.email : channel === "SMS" ? contact.mobileNumber : channel === "WHATSAPP" ? contact.whatsappNumber : null;
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      expiresAt = new Date(String(body.expiresAt));
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new ApiError(400, "expiresAt must be a future date.");
    }
    const row = await addSuppression({
      channel,
      reason: oneOf(body.reason, ["USER_REQUEST", "ADMIN_RESTRICTION", "TEMPORARY_LIMIT"] as const, "reason"),
      scope: oneOf(body.scope ?? "ALL", SUPPRESSION_SCOPES, "scope"),
      profileId,
      destination,
      expiresAt,
      note: str(body.note, "note", { max: 300, optional: true }) || null,
      actorId: admin.id,
    });
    return NextResponse.json({ id: row.id, status: row.status }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
