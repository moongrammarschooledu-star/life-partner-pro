import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { reviewFormVersion } from "@/lib/marketing/form-service";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:forms:manage");
    const { id } = await params;
    const b = await readBody(req);
    const decision = str(b, "decision", { required: true });
    if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpError(400, "decision must be APPROVE or REJECT.");
    return NextResponse.json(await reviewFormVersion(admin, id, int(b, "version") as number, decision, str(b, "note", { max: 500 }) || undefined));
  } catch (error) {
    return marketingError(error);
  }
}
