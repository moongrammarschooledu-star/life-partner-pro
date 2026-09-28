import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { searchLogs } from "@/lib/communications/log-service";
import { CHANNELS, dateParam, optionalOneOf, takeParam } from "@/lib/communications/route-utils";

// Communication history search. Never returns message content or a full address (masked reference only).
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("communications:logs:view");
    const q = new URL(req.url).searchParams;
    const result = await searchLogs(admin, {
      channel: optionalOneOf(q.get("channel"), CHANNELS, "channel"),
      status: (q.get("status") as never) ?? undefined,
      purpose: q.get("purpose") ?? undefined,
      messageType: q.get("messageType") ?? undefined,
      profileId: q.get("profileId") ?? undefined,
      provider: q.get("provider") ?? undefined,
      templateId: q.get("templateId") ?? undefined,
      campaignId: q.get("campaignId") ?? undefined,
      blockedOnly: q.get("blocked") === "true",
      from: dateParam(q.get("from"), "from"),
      to: dateParam(q.get("to"), "to"),
      take: takeParam(q.get("take")),
      cursor: q.get("cursor") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
