import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { changeAnnouncement, type AnnouncementAction } from "@/lib/platform/announcements";

export const dynamic = "force-dynamic";

const ACTIONS: AnnouncementAction[] = ["UPDATE", "PUBLISH", "RESOLVE", "END"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:announcements:manage");
    const { id } = await params;
    const body = await readJson<Record<string, unknown>>(req);
    const action = body.action as AnnouncementAction;
    if (!ACTIONS.includes(action)) throw new ApiError(400, "Unknown action.");
    const input = action === "UPDATE" ? { kind: body.kind, title: body.title, body: body.body, audience: body.audience, showOnStatusPage: body.showOnStatusPage, startsAt: body.startsAt, endsAt: body.endsAt } : undefined;
    return NextResponse.json(await changeAnnouncement(admin, id, action, input));
  } catch (error) {
    return handleApiError(error);
  }
}