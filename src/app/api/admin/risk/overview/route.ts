import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { SafetyIntelligenceService } from "@/lib/risk/safety-intelligence";

// STEP 24 - Risk & Safety Center KPIs. Counts and ratios only - no profile-identifying data. Kept here (behind
// risk:view) rather than on the general dashboard so risk metrics never reach every dashboard viewer.
export async function GET() {
  try {
    await requireAdmin("risk:view");
    return NextResponse.json(await SafetyIntelligenceService.overview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
