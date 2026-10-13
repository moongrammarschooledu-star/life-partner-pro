import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createPost } from "@/lib/content/service";
import { createPostSchema } from "@/lib/content/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdmin("content:view");
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const items = await prisma.contentPost.findMany({
      where: { ...(type === "ARTICLE" || type === "GUIDE" ? { type } : {}), ...(status && ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"].includes(status) ? { status: status as "DRAFT" } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, type: true, slug: true, title: true, status: true, scheduledFor: true, publishedAt: true, updatedAt: true, updatedById: true, category: { select: { name: true } }, author: { select: { name: true } } },
    });
    const [authors, categories] = await Promise.all([
      prisma.contentAuthor.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.contentCategory.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, type: true, slug: true, name: true } }),
    ]);
    return NextResponse.json({ items, authors, categories });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("content:create");
    const parsed = createPostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Please check the fields and try again.");
    const post = await createPost(admin.id, parsed.data);
    return NextResponse.json({ id: post.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
