import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { writeAudit } from "@/lib/audit";

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
const SECURITY_FIELDS = ["loginMaxAttempts", "loginLockoutMinutes", "twoFactorRequiredRoles", "passwordMinLength"];

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("settings:edit");
    const { stepUpToken, ...body } = await req.json();

    const touchesSecurityFields = Object.keys(body).some((key) => SECURITY_FIELDS.includes(key));
    if (touchesSecurityFields && !verifyStepUpToken(stepUpToken, "REAUTH", admin.id)) {
      throw new ApiError(403, "Please re-enter your password to change security settings.");
    }

    const settings = await prisma.appSettings.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body },
    });

    if (touchesSecurityFields) {
      await writeAudit({ action: "SECURITY_SETTINGS_CHANGED", adminId: admin.id, meta: { fields: Object.keys(body).filter((k) => SECURITY_FIELDS.includes(k)) } });
    }

    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
