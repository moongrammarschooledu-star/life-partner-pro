import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { getActivityTimeline } from "@/lib/visibility/user-data-visibility";

export async function GET(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const category = url.searchParams.get("category") ?? undefined;

  const result = await getActivityTimeline(profileId, { page, category });
  return NextResponse.json(result);
}
