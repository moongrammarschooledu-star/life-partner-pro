import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { HttpError } from "@/lib/http-error";
import { listOwnReports, submitUserReport } from "@/lib/risk/report-service";

// STEP 24 - "Report a Concern". The reporter is ALWAYS the signed-in applicant (never taken from the body), the
// response reveals nothing about the reported profile or any risk state, and a report is described everywhere as
// an allegation that a human will review.
export async function POST(req: Request) {
  const limited = await enforceConfiguredLimit(req, "my-reports-create", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { reportType?: unknown; description?: unknown; reportedProfileCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const result = await submitUserReport({
      reporterProfileId: profileId,
      reportType: typeof body.reportType === "string" ? body.reportType : "",
      description: typeof body.description === "string" ? body.description : "",
      reportedProfileCode: typeof body.reportedProfileCode === "string" ? body.reportedProfileCode : null,
    });
    return NextResponse.json({ reportCode: result.reportCode, status: result.status, message: "Thank you. Your report has been received and will be reviewed by our team." });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ items: await listOwnReports(profileId) });
}
