import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { getThreadForProfile, postProfileMessage } from "@/lib/communications/thread-service";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";

// Only PUBLIC_TO_USER messages of a thread the applicant was explicitly added to; anything else answers 404 (no existence leak).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await getThreadForProfile(profileId, id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "my-communications-reply", { limit: 20, windowMs: 60_000 }, profileId);
    if (limited) return limited;
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await postProfileMessage(profileId, id, typeof body?.body === "string" ? body.body : ""), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
