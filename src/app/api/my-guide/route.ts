import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS, GUIDE_CATEGORIES } from "@/lib/engagement/constants";
import { listGuideArticles } from "@/lib/engagement/content-service";

// Published, reviewed guide articles only (no drafts, no unpublished versions).
export async function GET(req: Request) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return NextResponse.json({ enabled: false, items: [], categories: GUIDE_CATEGORIES });
    const q = new URL(req.url).searchParams;
    const language = q.get("language") === "UR" ? "UR" : q.get("language") === "EN" ? "EN" : undefined;
    const category = (GUIDE_CATEGORIES as readonly string[]).includes(q.get("category") ?? "") ? (q.get("category") as string) : undefined;
    const items = await listGuideArticles({ language, category, q: (q.get("q") ?? "").slice(0, 80) });
    return NextResponse.json({ enabled: true, items, categories: GUIDE_CATEGORIES }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
