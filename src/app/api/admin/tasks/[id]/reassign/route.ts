import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertTaskAccess } from "@/lib/workflow/access";
import { reassignTask } from "@/lib/workflow/engine";

// STEP 18 §43 — reassignment requires a reason, records previous/new owner,
// notifies both parties, and is fully audited (all handled inside
// reassignTask()/reassignAssignment()).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:reassign");
    const { id } = await params;
    const { newAdminId, reason } = (await req.json()) as { newAdminId?: string; reason?: unknown };
    if (!newAdminId?.trim()) throw new ApiError(400, "newAdminId is required.");
    const reasonText = requireReason(reason);

    const target = await prisma.adminUser.findUnique({ where: { id: newAdminId }, select: { id: true, active: true } });
    if (!target || !target.active) throw new ApiError(400, "That admin does not exist or is not active.");

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "MANAGE");

    const updated = await reassignTask({ taskId: id, newAdminId, reason: reasonText, actorId: admin.id });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
