import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { APPLICANT_BEHAVIOUR, API_BEHAVIOUR, MAINTENANCE_KINDS, getMaintenanceView, setMaintenance } from "@/lib/platform/maintenance";
import { currentEnvironment } from "@/lib/platform/environment";
import { getActiveFreeze } from "@/lib/platform/freeze";
import { listFreezes } from "@/lib/platform/freeze";
import { listBreakGlass } from "@/lib/platform/break-glass";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await requireAdmin("platform:maintenance:view");
    const [view, freeze, freezes, breakGlass] = await Promise.all([getMaintenanceView(), getActiveFreeze(), listFreezes(), listBreakGlass()]);
    return NextResponse.json({
      environment: currentEnvironment(), kinds: MAINTENANCE_KINDS, applicantBehaviour: APPLICANT_BEHAVIOUR, apiBehaviour: API_BEHAVIOUR,
      maintenance: view, activeFreeze: freeze, freezes, breakGlass,
      canManage: admin.permissions.includes("platform:maintenance:manage"), canFreeze: admin.permissions.includes("platform:change_freeze"), canBreakGlass: admin.permissions.includes("platform:break_glass"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Switch between normal, scheduled maintenance, emergency maintenance and read-only mode. Administrators and the sign-in/health/webhook/cron paths always stay
// reachable (see isExemptFromMaintenance); nothing is deleted and nothing is queued for later.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("platform:maintenance:manage");
    const body = await readJson<{ kind?: unknown; startsAt?: unknown; endsAt?: unknown; message?: unknown; reason?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "change maintenance mode");
    const result = await setMaintenance(admin, { kind: body.kind, startsAt: body.startsAt, endsAt: body.endsAt, message: body.message, reason: body.reason, environment: body.environment });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}