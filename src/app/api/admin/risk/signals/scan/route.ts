import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { runRiskSignalScan } from "@/lib/risk/signal-engine";

// Admin-triggered, single-profile risk scan — mirrors the existing
// /api/admin/verification/duplicate-scan route's own "never a background
// cron" precedent (this codebase has no queue/worker infrastructure).
export async function POST(req: Request) {
  try {
    await requireAdmin("risk:view");
    const { profileId } = (await req.json()) as { profileId?: string };
    if (!profileId) throw new ApiError(400, "profileId is required");

    const result = await runRiskSignalScan(profileId);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
