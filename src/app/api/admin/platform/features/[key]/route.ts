import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { FEATURE_FLAG_DEFS } from "@/lib/ops/feature-flag-defs";
import { applyFlagChange } from "@/lib/platform/flags";

export const dynamic = "force-dynamic";

// One feature flag. The service re-checks platform:features:manage, validates the state and rollout rule, names the environment, applies the change freeze,
// and sends a sensitive flag being switched ON in production through the approval gate. Switching OFF never needs approval, but a sensitive flag asks for a
// fresh password confirmation either way.
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("platform:features:manage");
    const { key } = await params;
    const def = FEATURE_FLAG_DEFS.find((d) => d.key === key);
    if (!def) throw new ApiError(404, "Not found.");
    const body = await readJson<{ state?: unknown; rolloutPercent?: unknown; targets?: unknown; reason?: string; environment?: string; stepUpToken?: string }>(req);
    if (def.sensitive) requireReauth(admin, body.stepUpToken, "change this feature");
    const result = await applyFlagChange(admin, { key, state: body.state, rolloutPercent: body.rolloutPercent, targets: body.targets, reason: body.reason, environment: body.environment });
    if (result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json({ key, state: result.state, version: result.version });
  } catch (error) {
    return handleApiError(error);
  }
}