import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { saveSearchPreset, getSearchPresets } from "@/lib/search/candidate-search";
import type { FilterGroup } from "@/lib/search/filter-builder";
import type { SavedSearchVisibility } from "@prisma/client";

export async function GET() {
  try {
    const admin = await requireAdmin("search:saved:view");
    const items = await getSearchPresets(admin);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// spec §19/§20 — a named, reusable filter; visibility beyond PRIVATE
// requires search:saved:edit (checked inside saveSearchPreset()).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("search:saved:create");
    const body = (await req.json()) as { name?: string; description?: string; filterGroup?: FilterGroup; visibility?: SavedSearchVisibility; departmentId?: string | null };
    if (!body.name?.trim()) throw new ApiError(400, "A name is required.");
    if (!body.filterGroup) throw new ApiError(400, "filterGroup is required.");

    const preset = await saveSearchPreset(admin, {
      name: body.name.trim(),
      description: body.description,
      filterGroup: body.filterGroup,
      visibility: body.visibility,
      departmentId: body.departmentId,
    });
    return NextResponse.json(preset);
  } catch (error) {
    return handleApiError(error);
  }
}
