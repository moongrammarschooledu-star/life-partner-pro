import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createAuthor } from "@/lib/content/service";
import { authorSchema } from "@/lib/content/schemas";

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("content:create");
    const parsed = authorSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Please check the fields and try again.");
    const author = await createAuthor(admin.id, parsed.data);
    return NextResponse.json({ id: author.id, name: author.name }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
