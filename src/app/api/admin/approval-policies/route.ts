import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { seedApprovalPolicies } from "@/lib/approvals/catalog";

// STEP 19 §9 — Approval Governance policy list. Seeded once (idempotent —
// never overwrites an admin's own edits), mirroring
// src/app/api/admin/tasks/automation-rules/route.ts's exact pattern.
export async function GET() {
  try {
    await requireAdmin("approvals:policy:view");
    await seedApprovalPolicies();
    const items = await prisma.approvalPolicy.findMany({ orderBy: { actionType: "asc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
