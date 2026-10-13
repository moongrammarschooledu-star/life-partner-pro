import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth, requireReason } from "@/lib/ops/admin-route";
import { adminRemoveDevice } from "@/lib/mobile/device-service";

export const dynamic = "force-dynamic";

// Remove a registered device (for example one reported lost): its push token is deleted and the session it used is signed out.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:mobile:manage");
    const { id } = await params;
    const body = await readJson<{ reason?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "remove a device");
    await adminRemoveDevice(admin.id, id, requireReason(body.reason));
    return NextResponse.json({ removed: true });
  } catch (error) {
    return handleApiError(error);
  }
}