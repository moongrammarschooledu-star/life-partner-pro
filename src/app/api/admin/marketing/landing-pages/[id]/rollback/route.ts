import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { rollbackLandingPage } from "@/lib/marketing/landing-service";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Clones an earlier approved version FORWARD as a new draft (it must be reviewed and published again).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:rollback");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await rollbackLandingPage(admin, id, int(b, "fromVersion") as number, str(b, "reason", { required: true, max: 500 })), { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
