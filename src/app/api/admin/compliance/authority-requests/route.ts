import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { listAuthorityRequests, createAuthorityRequest } from "@/lib/compliance/authority-requests";
import type { AuthorityRequestType } from "@prisma/client";

export async function GET(req: Request) {
  try {
    await requireAdmin("compliance:authority-requests:view");
    const { searchParams } = new URL(req.url);
    const items = await listAuthorityRequests({
      legalReviewStatus: searchParams.get("legalReviewStatus") ?? undefined,
      verificationStatus: searchParams.get("verificationStatus") ?? undefined,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("compliance:authority-requests:manage");
    const body = (await req.json()) as {
      requestType?: AuthorityRequestType;
      authority?: string;
      jurisdictionId?: string;
      requestReference?: string;
      scope?: string;
      deadline?: string;
    };

    if (!body.requestType) throw new ApiError(400, "requestType is required.");
    if (!body.authority?.trim()) throw new ApiError(400, "authority is required.");
    if (!body.scope?.trim()) throw new ApiError(400, "scope is required.");

    const request = await createAuthorityRequest(
      {
        requestType: body.requestType,
        authority: body.authority.trim(),
        jurisdictionId: body.jurisdictionId,
        requestReference: body.requestReference,
        scope: body.scope.trim(),
        deadline: body.deadline ? new Date(body.deadline) : undefined,
      },
      admin
    );
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
