import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { ACTIVE_TASK_STATUSES } from "@/lib/workflow/status";
import { subDays } from "date-fns";

// STEP 18 §10/§40 — KPI tiles for My/Team/All Work Queue. Only shows metrics
// the caller is authorized to view; "team"/"all" scopes are rejected exactly
// like the tasks list route, never silently narrowed.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("tasks:view");
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "own";
    const now = new Date();

    let where: Record<string, unknown> = { assignedToId: admin.id };
    if (scope === "team") {
      if (!admin.permissions.includes("tasks:view:team")) throw new ApiError(403, "You do not have permission to view your team's work.");
      const self = await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { departmentId: true } });
      where = self?.departmentId ? { assignedTo: { departmentId: self.departmentId } } : { assignedToId: admin.id };
    } else if (scope === "all") {
      if (!admin.permissions.includes("tasks:view:all")) throw new ApiError(403, "You do not have permission to view all work.");
      where = {};
    }

    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [openTasks, dueToday, dueTomorrow, overdue, highPriority, critical, waitingForUser, waitingForApproval, recentlyCompleted, reopened, escalated] = await Promise.all([
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES } } }),
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES }, dueAt: { lt: todayEnd, gte: now } } }),
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES }, dueAt: { gte: tomorrowStart, lt: tomorrowEnd } } }),
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES }, dueAt: { lt: now } } }),
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES }, priority: "HIGH" } }),
      prisma.adminTask.count({ where: { ...where, status: { in: ACTIVE_TASK_STATUSES }, priority: "CRITICAL" } }),
      prisma.adminTask.count({ where: { ...where, status: "WAITING_FOR_USER" } }),
      prisma.adminTask.count({ where: { ...where, status: "WAITING_FOR_APPROVAL" } }),
      prisma.adminTask.count({ where: { ...where, status: "COMPLETED", completedAt: { gte: subDays(now, 7) } } }),
      prisma.adminTask.count({ where: { ...where, status: "REOPENED" } }),
      prisma.adminTask.count({ where: { ...where, escalationStatus: "ESCALATED" } }),
    ]);

    return NextResponse.json({ openTasks, dueToday, dueTomorrow, overdue, highPriority, critical, waitingForUser, waitingForApproval, recentlyCompleted, reopened, escalated });
  } catch (error) {
    return handleApiError(error);
  }
}
