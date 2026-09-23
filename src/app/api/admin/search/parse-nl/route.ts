import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { parseSearchQuery, validateFilter } from "@/lib/ai/copilot/nl-filter";

// STEP 20 §41/§42 — AI-assisted search. Reuses the existing, already-safe
// regex-based parser verbatim (src/lib/ai/copilot/nl-filter.ts) rather than
// adding a new LLM call — see the STEP 20 plan's architecture decision 6.
// This route ONLY parses and validates; it never executes a search itself
// (the admin confirms the structured filter first — spec §42's "shown to
// the admin before execution" — then calls POST /api/admin/search/profiles
// separately with the confirmed criteria).
export async function POST(req: Request) {
  try {
    await requireAdmin("search:view");
    const body = (await req.json()) as { query?: string };
    if (!body.query?.trim()) throw new ApiError(400, "A search query is required.");
    if (body.query.length > 500) throw new ApiError(400, "The search query is too long.");

    const { filter, unsupported } = parseSearchQuery(body.query);
    let validated;
    try {
      validated = validateFilter(filter);
    } catch {
      return NextResponse.json({ filter: null, unsupported: [...unsupported, "The search could not be understood safely."] });
    }
    return NextResponse.json({ filter: validated, unsupported });
  } catch (error) {
    return handleApiError(error);
  }
}
