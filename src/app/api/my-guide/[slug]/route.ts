import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import { getGuideArticle } from "@/lib/engagement/content-service";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { slug } = await params;
    const article = await getGuideArticle(slug.slice(0, 80));
    if (!article) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ article }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
