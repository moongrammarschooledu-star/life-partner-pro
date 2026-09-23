import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { seedDefaultWorkflowRules } from "@/lib/workflow/automation-rules";

// STEP 18 §19 — the default rules are seeded once (idempotent — never
// overwrites an existing row) so the list is never empty on first visit.
export async function GET() {
  try {
    await requireAdmin("tasks:automation:manage");
    await seedDefaultWorkflowRules();
    const items = await prisma.workflowRule.findMany({ orderBy: { eventName: "asc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
