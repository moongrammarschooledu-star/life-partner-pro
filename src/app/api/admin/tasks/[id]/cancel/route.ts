import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason } from "@/lib/ops/admin-route";
import { assertTaskAccess } from "@/lib/workflow/access";
import { cancelTask } from "@/lib/workflow/engine";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:cancel");
    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: unknown };
    const reasonText = requireReason(reason);

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "MANAGE");

    const updated = await cancelTask({ taskId: id, actorId: admin.id, reason: reasonText });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
