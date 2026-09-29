import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { createCategory, createType, listCategories } from "@/lib/documents/catalog";
import { oneOf, str } from "@/lib/documents/route-utils";

const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_SENSITIVE", "RESTRICTED"] as const;

// The configurable category/type catalog (spec §2/§3) — visible to anyone who can see documents, editable
// only by documents:manage_providers (the same permission that governs other platform-wide document configuration).
export async function GET() {
  try {
    await requireAdmin("documents:view");
    return NextResponse.json({ categories: await listCategories(false) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("documents:manage_providers");
    const body = await req.json().catch(() => ({}));
    if (body.kind === "CATEGORY") {
      const category = await createCategory(admin.id, { key: str(body.key, "key", { max: 50 }), label: str(body.label, "label", { max: 120 }), defaultClassification: body.defaultClassification ? oneOf(body.defaultClassification, CLASSIFICATIONS, "defaultClassification") : undefined });
      return NextResponse.json(category, { status: 201 });
    }
    const type = await createType(admin.id, {
      key: str(body.key, "key", { max: 50 }),
      label: str(body.label, "label", { max: 120 }),
      categoryKey: str(body.categoryKey, "categoryKey", { max: 50 }),
      defaultClassification: body.defaultClassification ? oneOf(body.defaultClassification, CLASSIFICATIONS, "defaultClassification") : undefined,
      requiresExpiry: body.requiresExpiry === true,
      acceptedMimeTypes: Array.isArray(body.acceptedMimeTypes) ? body.acceptedMimeTypes : undefined,
    });
    return NextResponse.json(type, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
