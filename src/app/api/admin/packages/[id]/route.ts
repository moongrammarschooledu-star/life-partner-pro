import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("finance:packages:view");
    const { id } = await params;
    const pkg = await prisma.package.findUnique({ where: { id }, include: { prices: { orderBy: { effectiveFrom: "desc" } }, entitlements: true } });
    if (!pkg) throw new ApiError(404, "Package not found");
    return NextResponse.json(pkg);
  } catch (error) {
    return handleApiError(error);
  }
}

// Never touches price — see [id]/prices for versioned price changes.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { name, description, active, status, packageType, trialEligibilityScope, displayOrder, trialDays, refundPolicyNote } = (await req.json()) as {
      name?: string; description?: string; active?: boolean; status?: "DRAFT" | "ACTIVE" | "INACTIVE" | "SCHEDULED" | "EXPIRED" | "ARCHIVED";
      packageType?: string; trialEligibilityScope?: "PER_PACKAGE" | "PER_ACCOUNT"; displayOrder?: number; trialDays?: number; refundPolicyNote?: string;
    };

    // STEP 27 §2/§4 — `active` stays a derived mirror of `status`, written by
    // this one code path: if `status` is provided it's authoritative and
    // `active` is derived from it; a bare legacy `active` toggle (no
    // `status`) maps onto ACTIVE/INACTIVE for backward compatibility.
    const resolvedStatus = status ?? (active !== undefined ? (active ? "ACTIVE" : "INACTIVE") : undefined);
    const resolvedActive = status !== undefined ? status === "ACTIVE" : active;

    const updated = await prisma.package.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description.trim() } : {}),
        ...(resolvedActive !== undefined ? { active: resolvedActive } : {}),
        ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
        ...(packageType !== undefined ? { packageType: packageType as never } : {}),
        ...(trialEligibilityScope !== undefined ? { trialEligibilityScope } : {}),
        ...(displayOrder !== undefined ? { displayOrder } : {}),
        ...(trialDays !== undefined ? { trialDays } : {}),
        ...(refundPolicyNote !== undefined ? { refundPolicyNote } : {}),
      },
    });

    await writeAudit({ action: resolvedStatus === "ACTIVE" ? "PACKAGE_ACTIVATED" : resolvedStatus === "ARCHIVED" ? "PACKAGE_ARCHIVED" : "PACKAGE_UPDATED", adminId: admin.id, meta: { packageId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
