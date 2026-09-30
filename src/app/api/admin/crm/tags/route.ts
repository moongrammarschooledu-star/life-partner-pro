import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createCrmTag, listCrmTags } from "@/lib/crm/crm-record-service";

// The global tag catalog (create/list) — separate from the per-record
// apply/remove routes under /api/admin/crm/[id]/tags.
export async function GET(req: Request) {
  try {
    await requireAdmin("crm:tags:view");
    const activeOnly = new URL(req.url).searchParams.get("includeInactive") !== "true";
    const items = await listCrmTags(activeOnly);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:tags:manage");
    const body = (await req.json()) as { name?: string; description?: string; category?: string; colorToken?: string };
    if (!body.name?.trim()) throw new ApiError(400, "A tag name is required.");

    const tag = await createCrmTag(admin.id, { ...body, name: body.name });
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
