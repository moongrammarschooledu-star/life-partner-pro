import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getProcessor, listAgreementsForProcessor, createAgreement } from "@/lib/compliance/processors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("compliance:providers:view");
    const { id } = await params;
    const processor = await getProcessor(id);
    if (!processor) throw new ApiError(404, "Processor not found");
    const items = await listAgreementsForProcessor(id);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:providers:manage");
    const { id } = await params;
    const processor = await getProcessor(id);
    if (!processor) throw new ApiError(404, "Processor not found");

    const body = (await req.json()) as {
      agreementType?: string;
      effectiveDate?: string;
      expiryDate?: string;
      jurisdictionId?: string;
      dataCategories?: string[];
      subprocessorTerms?: string;
      securityTerms?: string;
      transferTerms?: string;
    };
    if (!body.agreementType?.trim()) throw new ApiError(400, "agreementType is required.");

    const agreement = await createAgreement(
      {
        processorId: id,
        agreementType: body.agreementType.trim(),
        effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
        jurisdictionId: body.jurisdictionId,
        dataCategories: body.dataCategories ?? [],
        subprocessorTerms: body.subprocessorTerms,
        securityTerms: body.securityTerms,
        transferTerms: body.transferTerms,
      },
      admin
    );
    return NextResponse.json(agreement, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
