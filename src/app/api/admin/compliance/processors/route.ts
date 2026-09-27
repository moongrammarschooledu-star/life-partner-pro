import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { listProcessors, createProcessor } from "@/lib/compliance/processors";

export async function GET(req: Request) {
  try {
    await requireAdmin("compliance:providers:view");
    const { searchParams } = new URL(req.url);
    const items = await listProcessors({
      serviceType: searchParams.get("serviceType") ?? undefined,
      complianceStatus: searchParams.get("complianceStatus") ?? undefined,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("compliance:providers:manage");
    const body = (await req.json()) as {
      name?: string;
      serviceType?: string;
      legalEntity?: string;
      country?: string;
      processingRegions?: string[];
      dataTypes?: string[];
      subprocessors?: string[];
      transferMechanism?: string;
    };

    if (!body.name?.trim()) throw new ApiError(400, "name is required.");
    if (!body.serviceType?.trim()) throw new ApiError(400, "serviceType is required.");
    if (!body.country?.trim()) throw new ApiError(400, "country is required.");

    const processor = await createProcessor(
      {
        name: body.name.trim(),
        serviceType: body.serviceType.trim(),
        legalEntity: body.legalEntity,
        country: body.country.trim(),
        processingRegions: body.processingRegions ?? [],
        dataTypes: body.dataTypes ?? [],
        subprocessors: body.subprocessors,
        transferMechanism: body.transferMechanism,
      },
      admin
    );
    return NextResponse.json(processor, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
