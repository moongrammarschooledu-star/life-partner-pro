import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import type { CrmViewType, SavedSearchVisibility } from "@prisma/client";

async function assertOwnerOrBroadAccess(admin: Awaited<ReturnType<typeof requireAdmin>>, viewId: string) {
  const view = await prisma.crmSavedView.findUnique({ where: { id: viewId } });
  if (!view) throw new ApiError(404, "Saved view not found.");
  if (view.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) {
    throw new ApiError(403, "Only the view's owner or a manager can modify it.");
  }
  return view;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:saved_views:edit");
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string; description?: string; filterJson?: unknown; viewType?: CrmViewType; visibility?: SavedSearchVisibility;
    };
    await assertOwnerOrBroadAccess(admin, id);

    const updated = await prisma.crmSavedView.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.filterJson !== undefined ? { filterJson: body.filterJson as never } : {}),
        ...(body.viewType ? { viewType: body.viewType } : {}),
        ...(body.visibility ? { visibility: body.visibility } : {}),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:saved_views:delete");
    const { id } = await params;
    await assertOwnerOrBroadAccess(admin, id);
    await prisma.crmSavedView.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
