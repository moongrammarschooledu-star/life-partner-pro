import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { setCreativeStatus } from "@/lib/marketing/creative-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// ACTIVE/PAUSED/ARCHIVED only — approval itself goes through /review. Activating a creative uses approve authority.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:creatives:approve");
    const { id } = await params;
    const b = await readBody(req);
    const status = str(b, "status", { required: true });
    if (status !== "ACTIVE" && status !== "PAUSED" && status !== "ARCHIVED") throw new HttpError(400, "status must be ACTIVE, PAUSED or ARCHIVED.");
    return NextResponse.json(await setCreativeStatus(admin, id, status));
  } catch (error) {
    return marketingError(error);
  }
}
