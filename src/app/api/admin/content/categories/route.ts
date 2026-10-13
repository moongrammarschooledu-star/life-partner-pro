import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createCategory } from "@/lib/content/service";
import { categorySchema } from "@/lib/content/schemas";

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("content:create");
    const parsed = categorySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Please check the fields and try again.");
    const category = await createCategory(admin.id, parsed.data);
    return NextResponse.json({ id: category.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
