import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { runReconciliation } from "@/lib/finance/reconciliation";

// Spec §30 — SUPER_ADMIN only (finance:reconciliation:manage).
export async function POST() {
  try {
    const admin = await requireAdmin("finance:reconciliation:manage");
    const result = await runReconciliation(admin.id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
