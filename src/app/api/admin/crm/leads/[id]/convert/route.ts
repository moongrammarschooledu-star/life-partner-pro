import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { convertLead } from "@/lib/crm/lead-service";

// STEP 28 §10 — links a Lead to an already-registered applicant account
// (found by profileId, e.g. the lead self-registered using the same
// email/phone, or staff created the account separately) and creates its
// CrmRecord in the same step. Never creates the Profile itself — that stays
// the existing registration flow's job, untouched.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:leads:convert");
    const { id } = await params;
    const body = (await req.json()) as { profileId?: string };
    if (!body.profileId) throw new ApiError(400, "profileId is required.");

    const profile = await prisma.profile.findUnique({ where: { id: body.profileId }, select: { id: true } });
    if (!profile) throw new ApiError(404, "Profile not found.");

    const result = await convertLead(id, admin.id, body.profileId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
