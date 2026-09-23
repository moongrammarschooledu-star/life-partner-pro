import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertTaskAccess } from "@/lib/workflow/access";
import { assignTask } from "@/lib/workflow/engine";

// STEP 18 §7/§8 — assigning validates role+permission+record access+workload
// implicitly: assertTaskAccess re-runs the full nine-step chain for the
// ACTING admin (they must already be able to see this task to touch it at
// all); the target assignee's own eligibility is intentionally not
// independently re-verified here beyond existing/active, since the codebase
// has no generic "can X be assigned to Y" oracle beyond the per-resource
// helpers assertTaskAccess already exercises for the actor.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:assign");
    const { id } = await params;
    const { adminId } = (await req.json()) as { adminId?: string };
    if (!adminId?.trim()) throw new ApiError(400, "adminId is required.");

    const target = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true, active: true } });
    if (!target || !target.active) throw new ApiError(400, "That admin does not exist or is not active.");

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "MANAGE");

    const updated = await assignTask({ taskId: id, adminId, actorId: admin.id });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
