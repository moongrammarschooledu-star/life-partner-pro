import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { submitProposalResponse, ProposalResponseError } from "@/lib/proposal-response";

// Addressed by proposalCode, never the raw cuid (spec §2 — never expose
// internal database UUIDs to normal users). Rate-limited the same way
// /api/my-status's POST is — a signed cookie proves identity but doesn't by
// itself stop response-spam from a shared/compromised browser.
// Core logic lives in src/lib/proposal-response.ts (STEP 22) — extracted so
// the family-decision confirmation flow reuses it unchanged.
export async function POST(req: Request) {
  const key = `my-proposals-respond:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { proposalCode, response, reason, reasonNote } = await req.json();
    if (typeof proposalCode !== "string") {
      return NextResponse.json({ error: "A valid proposal and response are required." }, { status: 400 });
    }
    const result = await submitProposalResponse(profileId, proposalCode, response, reason, reasonNote);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProposalResponseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
