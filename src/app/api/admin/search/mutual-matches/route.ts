import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { findMutualCandidates } from "@/lib/search/candidate-search";
import type { FilterGroup } from "@/lib/search/filter-builder";

// spec §15 — "Find Mutual Candidates": reads the source profile's own
// partner requirements and scores every candidate through the existing
// STEP 6 deterministic engine (src/lib/matching.ts) — never a second engine.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("candidate:recommend");
    const body = (await req.json()) as { sourceProfileId?: string; filterGroup?: FilterGroup; cursor?: string | null; pageSize?: number };
    if (!body.sourceProfileId) throw new ApiError(400, "sourceProfileId is required.");

    const result = await findMutualCandidates(admin, body.sourceProfileId, {
      filterGroup: body.filterGroup,
      cursor: body.cursor,
      pageSize: body.pageSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
