import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { listRules, createRule } from "@/lib/compliance/rules";
import type { ComplianceSourceType } from "@prisma/client";

export async function GET(req: Request) {
  try {
    await requireAdmin("compliance:rules:view");
    const { searchParams } = new URL(req.url);
    const items = await listRules({
      jurisdictionId: searchParams.get("jurisdictionId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      requirementType: searchParams.get("requirementType") ?? undefined,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("compliance:rules:manage");
    const body = (await req.json()) as {
      jurisdictionId?: string;
      subject?: string;
      requirementType?: string;
      description?: string;
      sourceType?: ComplianceSourceType;
      sourceTitle?: string;
      sourceAuthority?: string;
      sourceReference?: string;
      sourceUrl?: string;
      sourcePublicationDate?: string;
      internalReviewNote?: string;
      effectiveFrom?: string;
      effectiveTo?: string;
      reviewDate?: string;
      configuration?: unknown;
    };

    if (!body.jurisdictionId) throw new ApiError(400, "jurisdictionId is required.");
    if (!body.subject?.trim()) throw new ApiError(400, "subject is required.");
    if (!body.requirementType?.trim()) throw new ApiError(400, "requirementType is required.");
    if (!body.description?.trim()) throw new ApiError(400, "description is required.");
    if (!body.sourceType) throw new ApiError(400, "sourceType is required.");
    if (!body.effectiveFrom) throw new ApiError(400, "effectiveFrom is required.");
    if (body.configuration === undefined) throw new ApiError(400, "configuration is required.");

    const rule = await createRule(
      {
        jurisdictionId: body.jurisdictionId,
        subject: body.subject.trim(),
        requirementType: body.requirementType.trim(),
        description: body.description.trim(),
        sourceType: body.sourceType,
        sourceTitle: body.sourceTitle,
        sourceAuthority: body.sourceAuthority,
        sourceReference: body.sourceReference,
        sourceUrl: body.sourceUrl,
        sourcePublicationDate: body.sourcePublicationDate ? new Date(body.sourcePublicationDate) : undefined,
        internalReviewNote: body.internalReviewNote,
        effectiveFrom: new Date(body.effectiveFrom),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        reviewDate: body.reviewDate ? new Date(body.reviewDate) : undefined,
        configuration: body.configuration,
      },
      admin
    );
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
