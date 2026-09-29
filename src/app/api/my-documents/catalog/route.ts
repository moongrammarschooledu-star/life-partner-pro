import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { listCategories } from "@/lib/documents/catalog";

// The active category/type catalog, for the upload wizard's "select document type" step.
export async function GET() {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    return NextResponse.json({ categories: await listCategories(true) });
  } catch (error) {
    return handleApiError(error);
  }
}
