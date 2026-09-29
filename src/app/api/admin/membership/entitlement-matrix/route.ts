import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertKnownFeatureKey } from "@/lib/finance/catalog";

// STEP 27 §25 — a Package x FeatureDefinition matrix, editable in one grid
// rather than one entitlement at a time (the gap the original packages page
// left open).
export async function GET() {
  try {
    await requireAdmin("finance:entitlements:view");
    const [packages, features, entitlements] = await Promise.all([
      prisma.package.findMany({ orderBy: { displayOrder: "asc" }, select: { id: true, name: true, packageCode: true, packageType: true, status: true } }),
      prisma.featureDefinition.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { label: "asc" }] }),
      prisma.packageEntitlement.findMany(),
    ]);
    return NextResponse.json({ packages, features, entitlements });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("finance:entitlements:manage");
    const { packageId, featureKey, limitValue, resetPeriod } = (await req.json()) as {
      packageId?: string; featureKey?: string; limitValue?: number | null; resetPeriod?: string | null;
    };
    if (!packageId || !featureKey) throw new ApiError(400, "A package and feature key are required.");
    await assertKnownFeatureKey(featureKey);

    const entitlement = await prisma.packageEntitlement.upsert({
      where: { packageId_featureKey: { packageId, featureKey } },
      update: { limitValue: limitValue ?? null, resetPeriod: resetPeriod ?? null },
      create: { packageId, featureKey, limitValue: limitValue ?? null, resetPeriod: resetPeriod ?? null },
    });
    await writeAudit({ action: "PACKAGE_UPDATED", adminId: admin.id, meta: { packageId, event: "entitlement_matrix_set", featureKey } });
    return NextResponse.json(entitlement);
  } catch (error) {
    return handleApiError(error);
  }
}
