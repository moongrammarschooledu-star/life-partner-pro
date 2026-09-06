import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { computeTeamWorkload } from "@/lib/reports/aggregate/team-workload";

// Spec §9 — ADMIN+SUPER_ADMIN, workload/service-quality view (not a ranking).
export async function GET() {
  try {
    await requireAdmin("staff:view", { allowViewAs: true });
    return NextResponse.json(await computeTeamWorkload());
  } catch (error) {
    return handleApiError(error);
  }
}
