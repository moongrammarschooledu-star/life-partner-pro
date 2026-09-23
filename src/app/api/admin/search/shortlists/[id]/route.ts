import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getShortlist, updateShortlistStatus } from "@/lib/search/candidate-search";
import type { ShortlistStatus } from "@prisma/client";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const { id } = await params;
    const shortlist = await getShortlist(admin, id);
    return NextResponse.json(shortlist);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const { id } = await params;
    const body = (await req.json()) as { status?: ShortlistStatus };
    if (!body.status) throw new ApiError(400, "status is required.");
    const updated = await updateShortlistStatus(admin, id, body.status);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
