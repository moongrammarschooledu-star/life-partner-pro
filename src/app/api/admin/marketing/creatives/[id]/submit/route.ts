import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { submitCreative } from "@/lib/marketing/creative-service";
import { marketingError } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:creatives:edit");
    const { id } = await params;
    return NextResponse.json(await submitCreative(admin, id));
  } catch (error) {
    return marketingError(error);
  }
}
