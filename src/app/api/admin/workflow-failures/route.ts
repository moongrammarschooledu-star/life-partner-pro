import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// STEP 18 §66 — Admin → Workflow Failures. Never silently discards a
// workflow event; unresolved failures stay visible here for inspection.
export async function GET(req: Request) {
  try {
    await requireAdmin("tasks:workflow-failures:view");
    const { searchParams } = new URL(req.url);
    const showResolved = searchParams.get("resolved") === "true";

    const items = await prisma.workflowFailure.findMany({
      where: showResolved ? {} : { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { workflowEvent: true, task: { select: { id: true, taskCode: true, title: true } }, resolvedBy: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
