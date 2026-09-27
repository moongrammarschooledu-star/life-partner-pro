import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getRule, activateRule } from "@/lib/compliance/rules";

// Lighter follow-up step (plan decision 3) — flips APPROVED -> ACTIVE. Still
// permission-gated and audited, but not a second full STEP 19 cycle (the
// legal decision already happened in the approve step).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:rules:manage");
    const { id } = await params;
    const existing = await getRule(id);
    if (!existing) throw new ApiError(404, "Compliance rule not found");
    if (existing.status !== "APPROVED") throw new ApiError(409, `Only an APPROVED rule may be activated (current status: ${existing.status}).`);

    const rule = await activateRule(id, admin);
    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError(error);
  }
}
