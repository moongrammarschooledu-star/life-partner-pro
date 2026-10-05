import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { archiveAnnouncement, publishAnnouncement, reviewAnnouncement, submitAnnouncement } from "@/lib/engagement/announcement-service";
import { HttpError } from "@/lib/http-error";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

const PERMISSION = {
  submit: "engagement:announcements:create",
  review: "engagement:approve",
  publish: "engagement:announcements:publish",
  archive: "engagement:announcements:publish",
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    if (!(action in PERMISSION)) throw new HttpError(404, "Unknown action.");
    const admin = await requireAdmin(PERMISSION[action as keyof typeof PERMISSION]);
    const b = await readBody(req);
    const reason = str(b, "reason", { max: 500 });
    switch (action) {
      case "submit": {
        const a = await submitAnnouncement(admin, id);
        return NextResponse.json({ id: a.id, status: a.status });
      }
      case "review": {
        const a = await reviewAnnouncement(admin, id, b.decision === "REJECT" ? "REJECT" : "APPROVE", reason);
        return NextResponse.json({ id: a.id, status: a.status });
      }
      case "publish": {
        const out = await publishAnnouncement(admin, id, reason);
        if (out.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: out.approvalCode, status: out.status }, { status: 202 });
        return NextResponse.json({ id: out.announcement.id, status: out.announcement.status });
      }
      default: {
        const a = await archiveAnnouncement(admin, id, reason);
        return NextResponse.json({ id: a.id, status: a.status });
      }
    }
  } catch (error) {
    return marketingError(error);
  }
}
