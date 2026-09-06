import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { reassignAssignment } from "@/lib/admin-assignment";

// Spec §21 — deactivating a staff account never silently orphans their open
// work. `action` decides what happens to it before the account is disabled;
// `stepUpToken` (from POST /api/admin/auth/reauth) proves a fresh password
// re-entry, per spec §16's "particularly sensitive operations" requirement.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { id } = await params;
    const { action, reassignTo, stepUpToken } = (await req.json()) as {
      action?: "reassign" | "unassign" | "department";
      reassignTo?: string;
      stepUpToken?: string;
    };

    if (!verifyStepUpToken(stepUpToken, "REAUTH", admin.id)) {
      throw new ApiError(403, "Please re-enter your password to continue.");
    }
    if (id === admin.id) throw new ApiError(400, "You cannot deactivate your own account");
    if (!action) throw new ApiError(400, "Choose what should happen to this admin's assigned records.");
    if (action === "reassign" && !reassignTo) throw new ApiError(400, "Select an admin to reassign records to.");

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "Admin not found");

    if (action === "reassign" && reassignTo) {
      const [openProposals, openVerifications, openFlags, openAssignments] = await Promise.all([
        prisma.proposal.findMany({ where: { assignedToId: id }, select: { id: true } }),
        prisma.profileVerification.findMany({ where: { assignedToId: id }, select: { profileId: true } }),
        prisma.securityFlag.findMany({ where: { assignedToId: id }, select: { id: true } }),
        prisma.adminAssignment.findMany({ where: { adminId: id, status: { not: "REASSIGNED" } }, select: { resourceType: true, resourceId: true } }),
      ]);

      await Promise.all([
        ...openProposals.map((p) => prisma.proposal.update({ where: { id: p.id }, data: { assignedToId: reassignTo } })),
        ...openVerifications.map((v) => prisma.profileVerification.update({ where: { profileId: v.profileId }, data: { assignedToId: reassignTo } })),
        ...openFlags.map((f) => prisma.securityFlag.update({ where: { id: f.id }, data: { assignedToId: reassignTo } })),
        ...openAssignments.map((a) =>
          reassignAssignment({
            resourceType: a.resourceType,
            resourceId: a.resourceId,
            newAdminId: reassignTo,
            reason: "Previous assignee deactivated",
            createdById: admin.id,
          })
        ),
      ]);
    } else if (action === "unassign") {
      await Promise.all([
        prisma.proposal.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } }),
        prisma.profileVerification.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } }),
        prisma.securityFlag.updateMany({ where: { assignedToId: id }, data: { assignedToId: null } }),
      ]);
    }
    // action === "department": historical records are left as-is — the
    // department itself remains the organizational owner (spec §21's third
    // option); no per-record change needed since assignment rows are kept
    // for audit/history purposes regardless.

    await prisma.adminUser.update({ where: { id }, data: { active: false } });
    await writeAudit({ action: "ADMIN_USER_DEACTIVATED", adminId: admin.id, meta: { targetAdminId: id, action, reassignTo } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
