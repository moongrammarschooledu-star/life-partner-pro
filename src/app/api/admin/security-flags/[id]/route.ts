import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertSecurityFlagAccess } from "@/lib/security-flag-access";
import { createAssignment } from "@/lib/admin-assignment";
import { notifySecurityFlagAssigned } from "@/lib/notifications/events";
import type { SecurityFlagStatus } from "@prisma/client";

const VALID_STATUSES: SecurityFlagStatus[] = ["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:flag:manage");
    const { id } = await params;
    const { status, assignedToId, resolution } = await req.json();

    if (status && !VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");

    const existing = await prisma.securityFlag.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Not found");
    assertSecurityFlagAccess(admin, existing);

    const isResolving = status === "RESOLVED" || status === "DISMISSED";
    const isReassigning = assignedToId !== undefined && assignedToId !== existing.assignedToId;

    const flag = await prisma.securityFlag.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(assignedToId !== undefined ? { assignedToId: assignedToId || null } : {}),
        ...(isResolving ? { resolution: resolution || null, resolvedById: admin.id, resolvedAt: new Date() } : {}),
      },
    });

    await writeAudit({
      action: isResolving ? "SECURITY_FLAG_RESOLVED" : "SECURITY_FLAG_UPDATED",
      adminId: admin.id,
      targetProfileId: flag.profileId,
      meta: { flagId: id, status },
    });

    if (isReassigning && assignedToId) {
      await createAssignment({
        adminId: assignedToId,
        resourceType: "SECURITY_FLAG",
        resourceId: id,
        createdById: admin.id,
      });
      await notifySecurityFlagAssigned(flag.profileId, assignedToId);
    }

    return NextResponse.json(flag);
  } catch (error) {
    return handleApiError(error);
  }
}
