import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { submitLandingVersion } from "@/lib/marketing/landing-service";
import { int, marketingError, readBody } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:landing_pages:edit");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await submitLandingVersion(admin, id, int(b, "version") as number));
  } catch (error) {
    return marketingError(error);
  }
}
