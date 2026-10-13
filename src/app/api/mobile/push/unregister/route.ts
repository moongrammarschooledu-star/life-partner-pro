import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { unregisterPushToken } from "@/lib/mobile/device-service";

export const dynamic = "force-dynamic";

// Deletes the push token of the person's own installation (the person turned notifications off, or signed out of the app).
export async function POST(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-device", { limit: 20, windowMs: 60_000 }, { write: true });
    if ("response" in g) return g.response;
    const body = (await req.json().catch(() => null)) as { installationId?: unknown } | null;
    return NextResponse.json(await unregisterPushToken(g.actor, body?.installationId));
  } catch (error) {
    return handleApiError(error);
  }
}