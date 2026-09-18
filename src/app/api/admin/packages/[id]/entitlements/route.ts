import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { featureKey, limitValue, resetPeriod } = (await req.json()) as { featureKey?: string; limitValue?: number | null; resetPeriod?: string | null };

    if (!featureKey?.trim()) throw new ApiError(400, "A feature key is required.");

    const entitlement = await prisma.packageEntitlement.upsert({
      where: { packageId_featureKey: { packageId: id, featureKey: featureKey.trim() } },
      update: { limitValue: limitValue ?? null, resetPeriod: resetPeriod ?? null },
      create: { packageId: id, featureKey: featureKey.trim(), limitValue: limitValue ?? null, resetPeriod: resetPeriod ?? null },
    });

    await writeAudit({ action: "PACKAGE_UPDATED", adminId: admin.id, meta: { packageId: id, event: "entitlement_set", featureKey } });

    return NextResponse.json(entitlement);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { featureKey } = (await req.json()) as { featureKey?: string };
    if (!featureKey) throw new ApiError(400, "A feature key is required.");

    await prisma.packageEntitlement.delete({ where: { packageId_featureKey: { packageId: id, featureKey } } });
    await writeAudit({ action: "PACKAGE_UPDATED", adminId: admin.id, meta: { packageId: id, event: "entitlement_removed", featureKey } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
