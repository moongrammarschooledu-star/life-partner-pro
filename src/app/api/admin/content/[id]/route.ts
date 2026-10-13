import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { deletePost, updatePost } from "@/lib/content/service";
import { updatePostSchema } from "@/lib/content/schemas";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("content:view");
    const { id } = await params;
    const post = await prisma.contentPost.findUnique({ where: { id }, include: { category: { select: { name: true } }, author: { select: { name: true } } } });
    if (!post) throw new ApiError(404, "Not found.");
    return NextResponse.json({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("content:edit");
    const { id } = await params;
    const parsed = updatePostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Please check the fields and try again.");
    const post = await updatePost(admin.id, id, parsed.data);
    return NextResponse.json({ id: post.id, version: post.version });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("content:delete");
    const { id } = await params;
    await deletePost(admin.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
