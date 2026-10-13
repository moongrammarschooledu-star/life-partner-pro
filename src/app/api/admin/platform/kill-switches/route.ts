import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { listKillSwitches, setKillSwitch } from "@/lib/platform/killswitch";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("platform:features:view");
    return NextResponse.json({ items: await listKillSwitches() });
  } catch (error) {
    return handleApiError(error);
  }
}

// Engage or release an emergency kill switch. Engaging stops NEW actions only (nothing is deleted). Needs a reason, the environment, a fresh password
// confirmation, and respects the change freeze (engaging is a restrictive emergency action; releasing is not).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin.permissions.includes("platform:features:manage") && !admin.permissions.includes("platform:maintenance:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
    const body = await readJson<{ key?: unknown; engage?: unknown; reason?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "use an emergency switch");
    const result = await setKillSwitch(admin, { key: body.key, engage: body.engage, reason: body.reason, environment: body.environment });
    if ("approvalRequired" in result && result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}