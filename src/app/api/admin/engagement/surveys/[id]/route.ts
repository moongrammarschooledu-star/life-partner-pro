import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { setSurveyStatus, surveyResults } from "@/lib/engagement/feedback-service";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";

// GET = aggregated results only (never who said what). POST = publish / unpublish / archive (a survey cannot be published by its author).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("engagement:feedback:view");
    const { id } = await params;
    return NextResponse.json(await surveyResults(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:feedback:manage");
    const { id } = await params;
    const b = await readBody(req);
    if (b.status !== "PUBLISHED" && b.status !== "UNPUBLISHED" && b.status !== "ARCHIVED") throw new HttpError(400, "Unknown status.");
    const s = await setSurveyStatus(admin, id, b.status);
    return NextResponse.json({ id: s.id, status: s.status });
  } catch (error) {
    return marketingError(error);
  }
}
