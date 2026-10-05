import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { archiveContent, publishContentVersion, reviewContentVersion, submitContentVersion, unpublishContent } from "@/lib/engagement/content-service";
import { HttpError } from "@/lib/http-error";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

const PERMISSION = {
  submit: "engagement:content:edit",
  review: "engagement:approve",
  publish: "engagement:content:publish",
  unpublish: "engagement:content:publish",
  archive: "engagement:content:publish",
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    if (!(action in PERMISSION)) throw new HttpError(404, "Unknown action.");
    const admin = await requireAdmin(PERMISSION[action as keyof typeof PERMISSION]);
    const b = await readBody(req);
    const reason = str(b, "reason", { max: 500 });
    switch (action) {
      case "submit":
        return NextResponse.json(await submitContentVersion(admin, id, int(b, "version") as number));
      case "review":
        return NextResponse.json(await reviewContentVersion(admin, id, int(b, "version") as number, b.decision === "REJECT" ? "REJECT" : "APPROVE", reason));
      case "publish": {
        const out = await publishContentVersion(admin, id, int(b, "version") as number, reason);
        if (out.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: out.approvalCode, status: out.status }, { status: 202 });
        return NextResponse.json({ ok: true });
      }
      case "unpublish":
        return NextResponse.json(await unpublishContent(admin, id, reason));
      default:
        return NextResponse.json(await archiveContent(admin, id, reason));
    }
  } catch (error) {
    return marketingError(error);
  }
}
