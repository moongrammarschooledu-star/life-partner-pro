import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { validateFilterGroup, type FilterGroup } from "@/lib/search/filter-builder";
import { writeAudit } from "@/lib/audit";
import type { SavedSearchVisibility } from "@prisma/client";

async function requireOwnedPreset(id: string, admin: { id: string; role: import("@/lib/permissions").AdminRole }) {
  const preset = await prisma.savedSearch.findUnique({ where: { id } });
  if (!preset) throw new ApiError(404, "Saved search not found.");
  if (preset.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) throw new ApiError(403, "You do not have permission to modify this saved search.");
  return preset;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("search:saved:edit");
    const { id } = await params;
    const existing = await requireOwnedPreset(id, admin);
    const body = (await req.json()) as { name?: string; description?: string; filterGroup?: FilterGroup; visibility?: SavedSearchVisibility };

    if (body.filterGroup) validateFilterGroup(body.filterGroup, admin.permissions);

    const updated = await prisma.savedSearch.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? existing.name,
        description: body.description ?? existing.description,
        filterJson: body.filterGroup ? JSON.parse(JSON.stringify(body.filterGroup)) : existing.filterJson,
        visibility: body.visibility ?? existing.visibility,
      },
    });
    await writeAudit({ action: "SAVED_SEARCH_UPDATED", adminId: admin.id, meta: { presetId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("search:saved:delete");
    const { id } = await params;
    await requireOwnedPreset(id, admin);
    await prisma.savedSearch.delete({ where: { id } });
    await writeAudit({ action: "SAVED_SEARCH_DELETED", adminId: admin.id, meta: { presetId: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
