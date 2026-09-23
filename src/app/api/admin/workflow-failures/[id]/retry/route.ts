import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { retryWorkflowEvent } from "@/lib/workflow/retry";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:workflow-failures:resolve");
    const { id } = await params;

    const failure = await prisma.workflowFailure.findUnique({ where: { id } });
    if (!failure) throw new ApiError(404, "Workflow failure not found.");
    if (!failure.workflowEventId) throw new ApiError(400, "This failure has no associated workflow event to retry.");

    const result = await retryWorkflowEvent(failure.workflowEventId, admin.id);
    if (!result.ok) throw new ApiError(400, result.error ?? "Retry failed.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
