import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { writeAudit } from "@/lib/audit";
import type { CrmViewType, SavedSearchVisibility } from "@prisma/client";

// Mirrors SavedSearch's own visibility rule: PRIVATE views are owner-only,
// SHARED/TEAM/PUBLIC-equivalent tiers (whatever SavedSearchVisibility
// defines) are visible to everyone with crm:saved_views:view.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("crm:saved_views:view");
    const items = await prisma.crmSavedView.findMany({
      where: { OR: [{ ownerId: admin.id }, { visibility: { not: "PRIVATE" } }] },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:saved_views:create");
    const body = (await req.json()) as {
      name?: string; description?: string; filterJson?: unknown; viewType?: CrmViewType;
      visibility?: SavedSearchVisibility; departmentId?: string;
    };
    if (!body.name?.trim()) throw new ApiError(400, "A view name is required.");
    if (!body.filterJson || typeof body.filterJson !== "object") throw new ApiError(400, "filterJson is required.");

    const viewCode = await nextSequenceCode("CRMV");
    const view = await prisma.crmSavedView.create({
      data: {
        viewCode,
        ownerId: admin.id,
        name: body.name.trim(),
        description: body.description,
        filterJson: body.filterJson as never,
        viewType: body.viewType ?? "TABLE",
        visibility: body.visibility ?? "PRIVATE",
        departmentId: body.departmentId,
      },
    });
    await writeAudit({ action: "CRM_SAVED_VIEW_CREATED", adminId: admin.id, meta: { viewId: view.id, viewCode } });
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
