import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getProcessor, updateProcessor, recordProcessorReview } from "@/lib/compliance/processors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("compliance:providers:view");
    const { id } = await params;
    const processor = await getProcessor(id);
    if (!processor) throw new ApiError(404, "Processor not found");
    return NextResponse.json(processor);
  } catch (error) {
    return handleApiError(error);
  }
}

// A plain field edit, OR — when `complianceStatus` is present — the one,
// explicit, reviewer-driven path that may change it (never auto-derived
// from a certification or technical config, spec §52).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:providers:manage");
    const { id } = await params;
    const existing = await getProcessor(id);
    if (!existing) throw new ApiError(404, "Processor not found");

    const body = (await req.json()) as {
      name?: string;
      serviceType?: string;
      legalEntity?: string;
      country?: string;
      processingRegions?: string[];
      dataTypes?: string[];
      subprocessors?: string[];
      transferMechanism?: string;
      contractStatus?: string;
      complianceStatus?: string;
      reviewNote?: string;
      nextReviewDue?: string;
    };

    if (body.complianceStatus) {
      if (!body.reviewNote?.trim()) throw new ApiError(400, "A reviewNote is required when changing complianceStatus.");
      const processor = await recordProcessorReview(id, body.complianceStatus, admin, body.reviewNote.trim(), body.nextReviewDue ? new Date(body.nextReviewDue) : undefined);
      return NextResponse.json(processor);
    }

    const processor = await updateProcessor(
      id,
      {
        name: body.name,
        serviceType: body.serviceType,
        legalEntity: body.legalEntity,
        country: body.country,
        processingRegions: body.processingRegions,
        dataTypes: body.dataTypes,
        subprocessors: body.subprocessors,
        transferMechanism: body.transferMechanism,
        contractStatus: body.contractStatus,
      },
      admin
    );
    return NextResponse.json(processor);
  } catch (error) {
    return handleApiError(error);
  }
}
