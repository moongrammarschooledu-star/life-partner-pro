import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getRule, suspendRule } from "@/lib/compliance/rules";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("compliance:rules:manage");
    const { id } = await params;
    const existing = await getRule(id);
    if (!existing) throw new ApiError(404, "Compliance rule not found");
    if (existing.status !== "ACTIVE") throw new ApiError(409, `Only an ACTIVE rule may be suspended (current status: ${existing.status}).`);

    const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "A reason is required to suspend a compliance rule.");

    const rule = await suspendRule(id, admin, reason.trim());
    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError(error);
  }
}
