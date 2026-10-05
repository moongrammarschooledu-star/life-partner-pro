import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { reviewLandingVersion } from "@/lib/marketing/landing-service";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Approve/reject a version in review. The service refuses the version's own author as reviewer.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:approve");
    const { id } = await params;
    const b = await readBody(req);
    const decision = str(b, "decision", { required: true });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(400, "decision must be APPROVE or REJECT.");
    return NextResponse.json(await reviewLandingVersion(admin, id, int(b, "version") as number, decision, str(b, "note", { max: 500 }) || undefined));
  } catch (error) {
    return marketingError(error);
  }
}
