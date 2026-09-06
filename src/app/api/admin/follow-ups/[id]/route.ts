import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertFollowUpAccess } from "@/lib/followup-access";
import { createAssignment, reassignAssignment, getCurrentAssigneeId } from "@/lib/admin-assignment";
import { notifyAdmins } from "@/lib/notifications/notification-service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communication:add");
    const { id } = await params;
    const { done, status, outcome, assignedToId, priority, dueAt, reason } = await req.json();

    const existing = await prisma.followUp.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Follow-up not found");
    await assertFollowUpAccess(admin, existing);

    const data =
      status === "CANCELLED"
        ? { status: "CANCELLED" as const }
        : done
          ? { status: "COMPLETED" as const, completedAt: new Date(), outcome: outcome || undefined }
          : status === "PENDING" || done === false
            ? { status: "PENDING" as const, completedAt: null }
            : {};

    const followUp = await prisma.followUp.update({ where: { id }, data });

    if (assignedToId) {
      const currentAssigneeId = await getCurrentAssigneeId("FOLLOW_UP", id);
      if (currentAssigneeId && currentAssigneeId !== assignedToId) {
        await reassignAssignment({
          resourceType: "FOLLOW_UP",
          resourceId: id,
          newAdminId: assignedToId,
          reason: reason || "Reassigned",
          createdById: admin.id,
          priority,
          dueAt: dueAt ? new Date(dueAt) : undefined,
        });
      } else if (!currentAssigneeId) {
        await createAssignment({
          adminId: assignedToId,
          resourceType: "FOLLOW_UP",
          resourceId: id,
          priority,
          dueAt: dueAt ? new Date(dueAt) : null,
          createdById: admin.id,
        });
      }
      await notifyAdmins({ type: "ADMIN_ASSIGNMENT_CHANGED", data: { relatedProfileId: existing.profileId }, assignedAdminId: assignedToId });
    }

    return NextResponse.json(followUp);
  } catch (error) {
    return handleApiError(error);
  }
}
