import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth, requireReason } from "@/lib/ops/admin-route";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { writeAudit } from "@/lib/audit";
import { sendTestPush } from "@/lib/mobile/push-service";

export const dynamic = "force-dynamic";

// Sends ONE fixed, generic test notification to ONE registered device (by its device id). It cannot send custom text and it cannot broadcast: bulk
// notifications are not part of this system. Needs a reason and a fresh password confirmation; audited; rate limited per administrator.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("platform:mobile:push");
    const limited = await enforceConfiguredLimit(req, "mobile-admin-push-test", { limit: 6, windowMs: 60_000 }, admin.id);
    if (limited) return limited;
    const body = await readJson<{ deviceId?: unknown; reason?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "send a test notification");
    const reason = requireReason(body.reason);
    if (typeof body.deviceId !== "string" || body.deviceId.length > 40) throw new ApiError(400, "Choose a device.");
    const result = await sendTestPush(body.deviceId);
    await writeAudit({ action: "MOBILE_PUSH_TEST_SENT", adminId: admin.id, meta: { deviceId: body.deviceId, result: result.status, reason } });
    return NextResponse.json({ result: result.status, reason: result.reason ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}