import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getCampaign, updateCampaign } from "@/lib/communications/campaign-service";
import { PURPOSES, oneOf, readJson, str } from "@/lib/communications/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("communications:campaigns:view");
    const { id } = await params;
    return NextResponse.json(await getCampaign(id));
  } catch (error) {
    return handleApiError(error);
  }
}

// Only a DRAFT campaign can be edited; anything already submitted is immutable so approval covers exactly what runs.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:campaigns:create");
    const { id } = await params;
    const body = await readJson(req);
    const campaign = await updateCampaign(admin, id, {
      ...(body.name !== undefined ? { name: str(body.name, "name", { max: 120 }) } : {}),
      ...(body.purpose !== undefined ? { purpose: oneOf(body.purpose, PURPOSES, "purpose") } : {}),
      ...(body.templateId !== undefined ? { templateId: str(body.templateId, "templateId", { max: 60 }) } : {}),
      ...(body.audienceFilter !== undefined ? { audienceFilter: body.audienceFilter } : {}),
      ...(body.scheduledAt !== undefined ? { scheduledAt: body.scheduledAt ? new Date(String(body.scheduledAt)) : null } : {}),
    });
    return NextResponse.json(campaign);
  } catch (error) {
    return handleApiError(error);
  }
}
