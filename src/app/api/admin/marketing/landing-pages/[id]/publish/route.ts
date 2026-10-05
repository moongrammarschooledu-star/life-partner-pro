import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { publishLandingVersion } from "@/lib/marketing/landing-service";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:publish");
    const { id } = await params;
    const b = await readBody(req);
    const outcome = await publishLandingVersion(admin, id, int(b, "version") as number, str(b, "reason", { required: true, max: 500 }));
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return NextResponse.json(outcome.version);
  } catch (error) {
    return marketingError(error);
  }
}
