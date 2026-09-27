import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getAuthorityRequest, recordVerification } from "@/lib/compliance/authority-requests";

// Confirms (or rejects) that the request genuinely came from the authority
// it claims to — spec §29's independent, auditable check, distinct from the
// legal-review decision in PATCH [id].
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:authority-requests:manage");
    const { id } = await params;
    const existing = await getAuthorityRequest(id);
    if (!existing) throw new ApiError(404, "Authority request not found");

    const body = (await req.json()) as { verified?: boolean; note?: string };
    if (typeof body.verified !== "boolean") throw new ApiError(400, "verified (boolean) is required.");
    if (!body.note?.trim()) throw new ApiError(400, "A note is required when recording verification.");

    const request = await recordVerification(id, body.verified, admin, body.note.trim());
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
