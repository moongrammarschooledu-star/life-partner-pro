import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { CAMPAIGN_FILTER_FIELDS, MAX_CAMPAIGN_RECIPIENTS, CAMPAIGN_APPROVAL_THRESHOLD, createCampaign, listCampaigns } from "@/lib/communications/campaign-service";
import { EXTERNAL, MESSAGE_TYPES, PURPOSES, oneOf, readJson, str, takeParam } from "@/lib/communications/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("communications:campaigns:view");
    const items = await listCampaigns(takeParam(new URL(req.url).searchParams.get("take"), 100));
    return NextResponse.json({ items, filterFields: CAMPAIGN_FILTER_FIELDS, maxRecipients: MAX_CAMPAIGN_RECIPIENTS, approvalThreshold: CAMPAIGN_APPROVAL_THRESHOLD });
  } catch (error) {
    return handleApiError(error);
  }
}

// The audience is an allow-listed filter (never a list of contact details, never a sensitive trait); the service validates it.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:campaigns:create");
    const body = await readJson(req);
    let scheduledAt: Date | null = null;
    if (body.scheduledAt) {
      scheduledAt = new Date(String(body.scheduledAt));
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) throw new ApiError(400, "scheduledAt must be a future date.");
    }
    const campaign = await createCampaign(admin, {
      name: str(body.name, "name", { max: 120 }),
      purpose: oneOf(body.purpose, PURPOSES, "purpose"),
      messageType: oneOf(body.messageType, MESSAGE_TYPES, "messageType"),
      channel: oneOf(body.channel, EXTERNAL, "channel"),
      templateId: str(body.templateId, "templateId", { max: 60 }),
      audienceFilter: body.audienceFilter,
      scheduledAt,
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
