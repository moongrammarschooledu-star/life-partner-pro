import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assessTransfer } from "@/lib/compliance/transfer";
import type { DataClassification } from "@prisma/client";

export async function GET(req: Request) {
  try {
    await requireAdmin("compliance:jurisdictions:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const items = await prisma.dataTransferAssessment.findMany({
      where: { ...(status && { status: status as never }) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// A manually-triggered assessment (e.g. an admin evaluating a planned
// integration before it goes live) — the same assessTransfer() used by the
// automatic hooks (checkout, verification-provider session), so it never
// defaults to ALLOWED here either.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("compliance:jurisdictions:manage");
    const body = (await req.json()) as {
      sourceJurisdictionId?: string;
      destJurisdictionId?: string;
      destJurisdictionCode?: string;
      dataClass?: DataClassification;
      dataType?: string;
      purpose?: string;
      provider?: string;
      storageLocation?: string;
      transferMechanism?: string;
      userConsentRequired?: boolean;
      userConsentObtained?: boolean;
      contractualControls?: string;
    };

    if (!body.dataClass) throw new ApiError(400, "dataClass is required.");
    if (!body.dataType?.trim()) throw new ApiError(400, "dataType is required.");
    if (!body.purpose?.trim()) throw new ApiError(400, "purpose is required.");

    const assessment = await assessTransfer({ ...body, dataClass: body.dataClass, dataType: body.dataType.trim(), purpose: body.purpose.trim(), assessedById: admin.id });
    return NextResponse.json(assessment, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
