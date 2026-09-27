import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { listJurisdictions, createJurisdiction } from "@/lib/compliance/jurisdiction";

export async function GET() {
  try {
    await requireAdmin("compliance:jurisdictions:view");
    const items = await listJurisdictions();
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("compliance:jurisdictions:manage");
    const body = (await req.json()) as { jurisdictionCode?: string; countryCode?: string; regionCode?: string; name?: string; effectiveFrom?: string; effectiveTo?: string; configuration?: unknown };

    if (!body.jurisdictionCode?.trim()) throw new ApiError(400, "jurisdictionCode is required.");
    if (!body.countryCode?.trim()) throw new ApiError(400, "countryCode is required.");
    if (!body.name?.trim()) throw new ApiError(400, "name is required.");

    const jurisdiction = await createJurisdiction(
      {
        jurisdictionCode: body.jurisdictionCode.trim(),
        countryCode: body.countryCode.trim(),
        regionCode: body.regionCode?.trim() || undefined,
        name: body.name.trim(),
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        configuration: body.configuration,
      },
      admin.id
    );
    return NextResponse.json(jurisdiction, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
