import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { registerPushToken } from "@/lib/mobile/device-service";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";

export const dynamic = "force-dynamic";

// Stores the device's push token (encrypted). Only for the signed-in person's own registered installation; the token is never returned.
export async function POST(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 20, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    if (!(await isFeatureEnabled("mobile.push.enabled"))) return NextResponse.json({ error: "Notifications are not available yet." }, { status: 503 });
    const body = await req.json().catch(() => null);
    return NextResponse.json(await registerPushToken(g.actor, body));
  } catch (error) {
    return handleApiError(error);
  }
}