import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertTaskAccess } from "@/lib/workflow/access";
import { writeAudit } from "@/lib/audit";
import { notifyTaskCommentMention } from "@/lib/notifications/events";
import type { TaskCommentVisibility } from "@prisma/client";

// STEP 18 §16/§17 — internal task comments, never exposed through any
// public/user-facing API. MANAGER_ONLY visibility requires the stronger
// tasks:comment:internal permission; ordinary INTERNAL/TEAM comments just
// need the base tasks:comment permission the caller already holds to be
// looking at the task at all.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:comment");
    const { id } = await params;
    const { body, visibility, mentionedAdminIds } = (await req.json()) as {
      body?: string;
      visibility?: TaskCommentVisibility;
      mentionedAdminIds?: string[];
    };
    if (!body?.trim()) throw new ApiError(400, "Comment body is required.");

    const requestedVisibility: TaskCommentVisibility = visibility ?? "INTERNAL";
    if (requestedVisibility === "MANAGER_ONLY" && !admin.permissions.includes("tasks:comment:internal")) {
      throw new ApiError(403, "You do not have permission to post a manager-only comment.");
    }

    const task = await prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new ApiError(404, "Task not found.");
    await assertTaskAccess(admin, task, "COMMENT");

    const mentions = (mentionedAdminIds ?? []).filter((mid) => typeof mid === "string" && mid.trim());
    const comment = await prisma.taskComment.create({
      data: { taskId: id, authorId: admin.id, body: body.trim(), visibility: requestedVisibility, mentionedAdminIds: mentions },
    });

    await writeAudit({ action: "TASK_COMMENT_ADDED", adminId: admin.id, meta: { taskId: id, commentId: comment.id, visibility: requestedVisibility } });

    for (const mentionedId of mentions) {
      if (mentionedId !== admin.id) {
        await notifyTaskCommentMention(mentionedId, task.taskCode ?? task.id, task.title ?? task.taskType);
      }
    }

    return NextResponse.json(comment);
  } catch (error) {
    return handleApiError(error);
  }
}
