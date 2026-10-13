import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { writeAudit } from "@/lib/audit";
import { sanitiseAppSettingsPatch, SECURITY_APP_SETTINGS } from "@/lib/settings/app-settings-guard";

export async function GET() {
  try {
    await requireAdmin("profile:view");
    const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}

// Critical security settings (spec §16/§32) require a fresh password
// re-confirmation — see src/lib/step-up-token.ts. Every other setting
// (matching weights, thresholds, etc.) saves without it.
//
// STEP 36: the body is no longer written as-is. Only the allow-listed settings in app-settings-guard.ts can change here, each with its own range;
// payment, rollout and membership switches are managed in their own areas and are refused (with a message that says where) if they differ from the
// stored value. The settings page still sends the whole row back, so unchanged protected or unknown values are simply dropped.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("settings:edit");
    const raw = await req.json().catch(() => null);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "Invalid request.");
    const { stepUpToken, ...body } = raw as Record<string, unknown>;

    const current = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const result = sanitiseAppSettingsPatch(body, current as unknown as Record<string, unknown>);
    if (!result.ok) throw new ApiError(result.status, result.error);

    const touchesSecurityFields = Object.keys(result.data).some((key) => (SECURITY_APP_SETTINGS as readonly string[]).includes(key));
    if (touchesSecurityFields && !verifyStepUpToken(typeof stepUpToken === "string" ? stepUpToken : undefined, "REAUTH", admin.id)) {
      throw new ApiError(403, "Please re-enter your password to change security settings.");
    }

    const settings = Object.keys(result.data).length === 0 ? current : await prisma.appSettings.update({ where: { id: 1 }, data: result.data });

    if (touchesSecurityFields) {
      await writeAudit({ action: "SECURITY_SETTINGS_CHANGED", adminId: admin.id, meta: { fields: Object.keys(result.data).filter((k) => (SECURITY_APP_SETTINGS as readonly string[]).includes(k)) } });
    }

    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
