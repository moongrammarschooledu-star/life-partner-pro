import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §66/§68 — eligibility is configurable, never hard-coded: percentage
// rollout, and separate allowlists for beta (percentage/role/country) vs.
// the tighter internal-pilot allowlist (Phase 2, a short explicit list). An
// admin clears a restriction by saving [] (empty array), never a raw JSON
// null — see isEligibleForPaymentBeta in src/lib/finance/rollout.ts.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("finance:rollout:manage");
    const body = (await req.json()) as {
      paymentBetaPercentage?: number;
      paymentBetaAllowedProfileIds?: string[];
      paymentBetaAllowedCountries?: string[];
      paymentBetaAllowedPackageIds?: string[];
      paymentInternalAllowedProfileIds?: string[];
    };

    if (body.paymentBetaPercentage !== undefined && (body.paymentBetaPercentage < 0 || body.paymentBetaPercentage > 100)) {
      throw new ApiError(400, "Beta percentage must be between 0 and 100.");
    }

    const changed = Object.keys(body);
    const settings = await prisma.appSettings.upsert({
      where: { id: 1 },
      update: {
        ...(body.paymentBetaPercentage !== undefined ? { paymentBetaPercentage: body.paymentBetaPercentage } : {}),
        ...(body.paymentBetaAllowedProfileIds !== undefined ? { paymentBetaAllowedProfileIds: body.paymentBetaAllowedProfileIds } : {}),
        ...(body.paymentBetaAllowedCountries !== undefined ? { paymentBetaAllowedCountries: body.paymentBetaAllowedCountries } : {}),
        ...(body.paymentBetaAllowedPackageIds !== undefined ? { paymentBetaAllowedPackageIds: body.paymentBetaAllowedPackageIds } : {}),
        ...(body.paymentInternalAllowedProfileIds !== undefined ? { paymentInternalAllowedProfileIds: body.paymentInternalAllowedProfileIds } : {}),
      },
      create: {
        id: 1,
        ...(body.paymentBetaPercentage !== undefined ? { paymentBetaPercentage: body.paymentBetaPercentage } : {}),
        ...(body.paymentBetaAllowedProfileIds !== undefined ? { paymentBetaAllowedProfileIds: body.paymentBetaAllowedProfileIds } : {}),
        ...(body.paymentBetaAllowedCountries !== undefined ? { paymentBetaAllowedCountries: body.paymentBetaAllowedCountries } : {}),
        ...(body.paymentBetaAllowedPackageIds !== undefined ? { paymentBetaAllowedPackageIds: body.paymentBetaAllowedPackageIds } : {}),
        ...(body.paymentInternalAllowedProfileIds !== undefined ? { paymentInternalAllowedProfileIds: body.paymentInternalAllowedProfileIds } : {}),
      },
    });
    await writeAudit({ action: "PAYMENT_FEATURE_FLAG_CHANGED", adminId: admin.id, meta: { changed } });

    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
