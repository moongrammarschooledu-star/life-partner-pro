import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { listFeedback } from "@/lib/engagement/feedback-service";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

// Feedback is the applicant's own platform/support feedback. The profile id is returned only so staff can follow up through the
// normal profile screens; the message is shown to staff with engagement:feedback:view only.
export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:feedback:view");
    const { cursor, take } = pageParams(req.url);
    const q = new URL(req.url).searchParams;
    return NextResponse.json(await listFeedback({ type: q.get("type") ?? undefined, status: q.get("status") ?? undefined, take, cursor }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
