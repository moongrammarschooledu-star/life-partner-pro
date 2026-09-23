import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertTaskAccess } from "@/lib/workflow/access";
import { escalateTask } from "@/lib/workflow/engine";

// STEP 18 §22/§23/§74 — mirrors cases/[id]/escalate/route.ts's exact 4-level
// ladder: level 1->2 needs tasks:escalate, 2->3 needs tasks:escalate:senior,
// 3->4 is SUPER_ADMIN only. An assignee can never escalate themselves past a
// level their own permissions don't independently allow (no self-escalation
// into higher privilege, spec §74).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:escalate");
    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) throw new ApiError(400, "An escalation reason is required.");

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "MANAGE");

    const newLevel = Math.min(4, task.escalationLevel + 1);
    if (newLevel === task.escalationLevel) throw new ApiError(400, "This task is already at the highest escalation level.");
    if (newLevel >= 3 && !admin.permissions.includes("tasks:escalate:senior")) {
      throw new ApiError(403, "Escalating to this level requires senior escalation permission.");
    }
    if (newLevel >= 4 && admin.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "Only a Super Admin can escalate to the highest level.");
    }

    const updated = await escalateTask({ taskId: id, actorId: admin.id, reason: reason.trim() });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
