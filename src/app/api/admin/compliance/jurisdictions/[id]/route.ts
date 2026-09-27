import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getJurisdiction, updateJurisdiction } from "@/lib/compliance/jurisdiction";

const VALID_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("compliance:jurisdictions:view");
    const { id } = await params;
    const jurisdiction = await getJurisdiction(id);
    if (!jurisdiction) throw new ApiError(404, "Jurisdiction not found");
    return NextResponse.json(jurisdiction);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:jurisdictions:manage");
    const { id } = await params;
    const existing = await getJurisdiction(id);
    if (!existing) throw new ApiError(404, "Jurisdiction not found");

    const body = (await req.json()) as { countryCode?: string; regionCode?: string; name?: string; status?: string; effectiveFrom?: string; effectiveTo?: string; configuration?: unknown };
    if (body.status && !VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
      throw new ApiError(400, `status must be one of ${VALID_STATUSES.join(", ")}`);
    }

    const jurisdiction = await updateJurisdiction(
      id,
      {
        countryCode: body.countryCode,
        regionCode: body.regionCode,
        name: body.name,
        status: body.status as (typeof VALID_STATUSES)[number] | undefined,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        configuration: body.configuration,
      },
      admin.id
    );
    return NextResponse.json(jurisdiction);
  } catch (error) {
    return handleApiError(error);
  }
}
