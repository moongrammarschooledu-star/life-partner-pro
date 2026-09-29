import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { cancelRequest } from "@/lib/documents/request-service";
import { str } from "@/lib/documents/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("documents:manage_requests");
    const { id } = await params;
    const request = await prisma.documentRequest.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    if (!request) throw new ApiError(404, "Document request not found.");
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}

// Only cancellation is supported through PATCH today (disclosed deviation from the spec's generic
// "update status" shape) — every other transition (viewed/uploaded/reviewed) happens through its own
// real event (the applicant viewing/uploading, or the review decision), never a raw status edit.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:manage_requests");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.status !== "CANCELLED") throw new ApiError(400, "Only { status: \"CANCELLED\" } is supported here.");
    const updated = await cancelRequest(admin, id, str(body.reason, "reason", { max: 300 }));
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
