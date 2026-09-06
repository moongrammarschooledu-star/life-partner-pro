import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createAssignment, reassignAssignment, getCurrentAssigneeId } from "@/lib/admin-assignment";
import { notifyAdmins } from "@/lib/notifications/notification-service";

// General profile assignment (spec §7) — entirely new; Profile has no
// assignedToId column, so this is backed only by AdminAssignment rows (see
// src/lib/profile-assignment-access.ts for the STAFF row-scoping this
// enables).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:assign");
    const { id } = await params;
    const { assignedToId, priority, dueAt, notes, reason } = await req.json();
    if (!assignedToId) throw new ApiError(400, "assignedToId is required");

    const staff = await prisma.adminUser.findUnique({ where: { id: assignedToId } });
    if (!staff || !staff.active) throw new ApiError(400, "Invalid staff member");

    const currentAssigneeId = await getCurrentAssigneeId("PROFILE", id);
    const assignment = currentAssigneeId
      ? await reassignAssignment({
          resourceType: "PROFILE",
          resourceId: id,
          newAdminId: assignedToId,
          reason: reason || "Reassigned",
          createdById: admin.id,
          priority,
          dueAt: dueAt ? new Date(dueAt) : undefined,
        })
      : await createAssignment({
          adminId: assignedToId,
          resourceType: "PROFILE",
          resourceId: id,
          priority,
          dueAt: dueAt ? new Date(dueAt) : null,
          notes,
          createdById: admin.id,
        });

    await notifyAdmins({ type: "ADMIN_ASSIGNMENT_CHANGED", data: { relatedProfileId: id }, assignedAdminId: assignedToId });

    return NextResponse.json(assignment);
  } catch (error) {
    return handleApiError(error);
  }
}
