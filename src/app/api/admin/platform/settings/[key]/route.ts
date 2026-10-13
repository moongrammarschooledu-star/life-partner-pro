import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { findSettingDef, permissionForSetting } from "@/lib/platform/settings-registry";
import { setPlatformSetting } from "@/lib/platform/settings";

export const dynamic = "force-dynamic";

// One setting. The service re-checks the permission for the setting's category, validates the value against its type, names the environment, applies the
// change freeze and (for a high-risk setting) the approval gate. A high-risk setting also needs a fresh password confirmation here.
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin();
    const { key } = await params;
    const def = findSettingDef(key);
    if (!def) throw new ApiError(404, "Not found.");
    if (!admin.permissions.includes(permissionForSetting(def))) throw new ApiError(403, "Forbidden: insufficient permissions");
    const body = await readJson<{ value?: unknown; reason?: string; environment?: string; stepUpToken?: string }>(req);
    if (def.risk === "HIGH") requireReauth(admin, body.stepUpToken, "change this setting");
    const result = await setPlatformSetting(admin, { key, value: body.value, reason: body.reason, environment: body.environment });
    if (result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json({ key, version: result.version, value: result.value });
  } catch (error) {
    return handleApiError(error);
  }
}