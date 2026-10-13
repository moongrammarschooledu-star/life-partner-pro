import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { createAnnouncement, listAnnouncements } from "@/lib/platform/announcements";
import { ANNOUNCEMENT_KINDS, FIXED_AUDIENCES } from "@/lib/platform/announcement-rules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await requireAdmin("platform:announcements:view");
    return NextResponse.json({ kinds: ANNOUNCEMENT_KINDS, audiences: FIXED_AUDIENCES, items: await listAnnouncements(), canManage: admin.permissions.includes("platform:announcements:manage") });
  } catch (error) {
    return handleApiError(error);
  }
}

// Create a DRAFT announcement. Publishing is a separate action. Public text may not contain internal detail, links, markup or contact data (see publicSafetyProblems).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("platform:announcements:manage");
    const body = await readJson<Record<string, unknown>>(req);
    return NextResponse.json(await createAnnouncement(admin, { kind: body.kind, title: body.title, body: body.body, audience: body.audience, showOnStatusPage: body.showOnStatusPage, startsAt: body.startsAt, endsAt: body.endsAt }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}