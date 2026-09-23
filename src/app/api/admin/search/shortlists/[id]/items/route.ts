import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { addToShortlist } from "@/lib/search/candidate-search";

// spec §45 — duplicate-add is a no-op (@@unique([shortlistId, profileId])),
// enforced by addToShortlist()'s upsert, not by this route.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const { id } = await params;
    const body = (await req.json()) as { profileId?: string; adminNote?: string };
    if (!body.profileId) throw new ApiError(400, "profileId is required.");
    const item = await addToShortlist(admin, id, body.profileId, body.adminNote);
    return NextResponse.json(item);
  } catch (error) {
    return handleApiError(error);
  }
}
