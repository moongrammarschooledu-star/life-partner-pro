import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { reviewCreative } from "@/lib/marketing/creative-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// The service refuses the creative's own author as reviewer.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:creatives:approve");
    const { id } = await params;
    const b = await readBody(req);
    const decision = str(b, "decision", { required: true });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(400, "decision must be APPROVE or REJECT.");
    return NextResponse.json(await reviewCreative(admin, id, decision, str(b, "reason", { max: 300 }) || undefined));
  } catch (error) {
    return marketingError(error);
  }
}
