import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { BillingType } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("finance:packages:view");
    const packages = await prisma.package.findMany({
      include: { prices: { orderBy: { effectiveFrom: "desc" }, take: 1 }, entitlements: true },
      orderBy: { displayOrder: "asc" },
    });
    return NextResponse.json({ items: packages });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §5/§6 — the price is created alongside the package as its first
// PackagePrice row (append-only from here on — see the [id]/prices route
// for adding a new version).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { name, description, billingType, durationDays, trialDays, amountMinor, currencyCode, refundPolicyNote } = (await req.json()) as {
      name?: string; description?: string; billingType?: BillingType; durationDays?: number | null; trialDays?: number;
      amountMinor?: number; currencyCode?: string; refundPolicyNote?: string;
    };

    if (!name?.trim() || !description?.trim()) throw new ApiError(400, "Name and description are required.");
    if (!billingType) throw new ApiError(400, "A billing type is required.");
    if (typeof amountMinor !== "number" || amountMinor < 0 || !Number.isInteger(amountMinor)) throw new ApiError(400, "A valid price amount is required.");
    if (!currencyCode) throw new ApiError(400, "A currency is required.");

    const packageCode = await nextSequenceCode("PKG");
    const maxOrder = await prisma.package.aggregate({ _max: { displayOrder: true } });

    const pkg = await prisma.package.create({
      data: {
        packageCode,
        name: name.trim(),
        description: description.trim(),
        billingType,
        durationDays: durationDays ?? null,
        trialDays: trialDays ?? 0,
        refundPolicyNote: refundPolicyNote ?? null,
        displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
        createdById: admin.id,
        prices: { create: { amountMinor, currencyCode, createdById: admin.id } },
      },
    });

    await writeAudit({ action: "PACKAGE_CREATED", adminId: admin.id, meta: { packageId: pkg.id, packageCode } });

    return NextResponse.json(pkg);
  } catch (error) {
    return handleApiError(error);
  }
}
