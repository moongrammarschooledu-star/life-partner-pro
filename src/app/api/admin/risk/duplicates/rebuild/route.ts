import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { rebuildDuplicateClusters } from "@/lib/risk/duplicate-cluster-service";

// STEP 24 - idempotent cluster rebuild (also run by the daily batch). Rate limited: it reads every open candidate.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("duplicates:manage");
    const limited = await enforcePersistentLimit(req, "risk-cluster-rebuild", 6, 600_000, admin.id);
    if (limited) return limited;
    return NextResponse.json(await rebuildDuplicateClusters(admin.id));
  } catch (error) {
    return handleApiError(error);
  }
}
