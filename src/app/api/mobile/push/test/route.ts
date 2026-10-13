import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { mobileGuard } from "@/lib/mobile/route-guard";
import { ownerWhere } from "@/lib/mobile/auth";
import { sendTestPush } from "@/lib/mobile/push-service";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";

export const dynamic = "force-dynamic";

// "Send me a test notification": to one of the caller's OWN devices, with a fixed generic text, three tries per ten minutes.
export async function POST(req: Request) {
  try {
    const g = await mobileGuard(req, "mobile-push-test", { limit: 3, windowMs: 600_000 }, { write: true });
    if ("response" in g) return g.response;
    if (!(await isFeatureEnabled("mobile.push.enabled"))) return NextResponse.json({ error: "Notifications are not available yet." }, { status: 503 });
    const body = (await req.json().catch(() => null)) as { installationId?: unknown } | null;
    if (typeof body?.installationId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(body.installationId)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const device = await prisma.mobileDevice.findFirst({ where: { installationId: body.installationId, ...ownerWhere(g.actor), status: "ACTIVE" }, select: { id: true } });
    if (!device) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const r = await sendTestPush(device.id);
    return NextResponse.json({ result: r.status === "SENT" ? "SENT" : r.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : r.status === "NO_TOKEN" ? "NO_TOKEN" : "FAILED" });
  } catch (error) {
    return handleApiError(error);
  }
}