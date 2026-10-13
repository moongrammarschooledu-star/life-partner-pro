import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { listDevices, registerDevice } from "@/lib/mobile/device-service";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { versionAnswer } from "@/lib/mobile/version-service";

export const dynamic = "force-dynamic";

// The signed-in person's own devices. A token is never part of the answer.
export async function GET(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 60, windowMs: 60_000 });
    if ("response" in g) return g.response;
    const current = new URL(req.url).searchParams.get("installationId") ?? undefined;
    return NextResponse.json({ items: await listDevices(g.actor, current) });
  } catch (error) {
    return handleApiError(error);
  }
}

// Registers (or refreshes) the app installation that is signed in. An app version below the minimum is refused with 426 so it must update first.
export async function POST(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 30, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    const body = (await req.json().catch(() => null)) as { platform?: string; appVersion?: string } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const platform = body.platform === "ANDROID" || body.platform === "IOS" ? body.platform : null;
    if (!platform) return NextResponse.json({ error: "That device registration is not valid." }, { status: 400 });
    if (!(await isFeatureEnabled(platform === "ANDROID" ? "mobile.android.enabled" : "mobile.ios.enabled"))) return NextResponse.json({ error: "The app is temporarily unavailable." }, { status: 503 });
    const v = await versionAnswer(platform, body.appVersion);
    if (v.status === "UPDATE_REQUIRED") return NextResponse.json({ error: v.message, status: v.status, storeUrl: v.storeUrl }, { status: 426 });
    return NextResponse.json({ device: await registerDevice(g.actor, body) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}