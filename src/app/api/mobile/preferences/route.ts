import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { DEFAULT_DISPLAY_MODE, isDisplayMode } from "@/lib/mobile/push/payload";

export const dynamic = "force-dynamic";

// The applicant's account-level choice of what a push notification may show on the lock screen (FULL | PRIVATE | MINIMAL | OFF). PRIVATE until they choose.
// A family member has no account-level notification preferences: their choice is per device (PATCH /api/mobile/devices/[id]).
export async function GET(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 60, windowMs: 60_000 });
    if ("response" in g) return g.response;
    if (g.actor.kind !== "PROFILE") return NextResponse.json({ pushDisplayMode: null, scope: "DEVICE" });
    const row = await prisma.notificationPreference.findUnique({ where: { profileId: g.actor.profileId }, select: { pushDisplayMode: true } });
    return NextResponse.json({ pushDisplayMode: isDisplayMode(row?.pushDisplayMode) ? row?.pushDisplayMode : DEFAULT_DISPLAY_MODE, scope: "ACCOUNT" });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 30, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    if (g.actor.kind !== "PROFILE") return NextResponse.json({ error: "Not available for this account." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { pushDisplayMode?: unknown } | null;
    if (!isDisplayMode(body?.pushDisplayMode)) return NextResponse.json({ error: "Unknown notification display mode." }, { status: 400 });
    await prisma.notificationPreference.upsert({ where: { profileId: g.actor.profileId }, update: { pushDisplayMode: body.pushDisplayMode }, create: { profileId: g.actor.profileId, pushDisplayMode: body.pushDisplayMode } });
    return NextResponse.json({ pushDisplayMode: body.pushDisplayMode });
  } catch (error) {
    return handleApiError(error);
  }
}