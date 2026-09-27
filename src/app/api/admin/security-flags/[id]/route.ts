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
    // STEP 23 — the new Risk Signals workspace acts on this exact route
    // rather than a parallel one (SecurityFlag already IS the risk-signal
    // store, see the STEP 23 plan). verification:flag:manage remains
    // sufficient on its own (unchanged for existing callers); risk:review/
    // risk:resolve are the narrower STEP 23 grants that let a
    // VERIFICATION_MANAGER-style role act here without the broader
    // flag-management permission.
    const admin = await requireAdmin();
    const { id } = await params;
    const { status, assignedToId, resolution } = await req.json();

    if (status && !VALID_STATUSES.includes(status)) throw new ApiError(400, "Invalid status");
    const isResolving = status === "RESOLVED" || status === "DISMISSED";

    const hasBroadAccess = admin.permissions.includes("verification:flag:manage");
    const hasNarrowAccess = admin.permissions.includes(isResolving ? "risk:resolve" : "risk:review");
    if (!hasBroadAccess && !hasNarrowAccess) throw new ApiError(403, "You do not have permission to manage this flag.");

    const existing = await prisma.securityFlag.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Not found");
    assertSecurityFlagAccess(admin, existing);
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
