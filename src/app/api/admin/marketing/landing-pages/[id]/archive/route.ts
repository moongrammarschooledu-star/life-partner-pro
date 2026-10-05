import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { archiveLandingPage } from "@/lib/marketing/landing-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:unpublish");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await archiveLandingPage(admin, id, str(b, "reason", { required: true, max: 500 })));
  } catch (error) {
    return marketingError(error);
  }
}
