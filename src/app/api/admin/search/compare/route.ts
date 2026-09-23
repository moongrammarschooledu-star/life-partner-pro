import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { compareCandidates } from "@/lib/search/candidate-search";

// spec §26 — never lets AI declare a "winner"; only scoreMatch()'s
// deterministic, numeric/categorical output is ever returned here.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("candidate:compare");
    const body = (await req.json()) as { profileIds?: string[] };
    if (!Array.isArray(body.profileIds)) throw new ApiError(400, "profileIds must be an array.");

    const result = await compareCandidates(admin, body.profileIds);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
