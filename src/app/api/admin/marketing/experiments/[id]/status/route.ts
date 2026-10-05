import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { setExperimentStatus } from "@/lib/marketing/experiments";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:experiments:manage");
    const { id } = await params;
    const status = str(await readBody(req), "status", { required: true });
    if (status !== "RUNNING" && status !== "STOPPED" && status !== "ARCHIVED") throw new HttpError(400, "status must be RUNNING, STOPPED or ARCHIVED.");
    return NextResponse.json(await setExperimentStatus(admin, id, status));
  } catch (error) {
    return marketingError(error);
  }
}
