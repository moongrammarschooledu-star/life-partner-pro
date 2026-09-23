import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertTaskAccess } from "@/lib/workflow/access";
import { completeTask } from "@/lib/workflow/engine";

// STEP 18 §55/§56 — checklist/outcome/comment completion rules are enforced
// inside completeTask() itself, not duplicated here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:complete");
    const { id } = await params;
    const { outcome, completionNotes } = (await req.json().catch(() => ({}))) as { outcome?: string; completionNotes?: string };

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "EDIT");

    const updated = await completeTask({ taskId: id, actorId: admin.id, outcome, completionNotes });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
