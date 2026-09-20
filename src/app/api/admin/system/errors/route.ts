import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { ErrorCategory, ErrorEventStatus, ErrorSeverity, Prisma } from "@prisma/client";

// Error explorer (spec §13/§14): filter by severity, category, environment,
// service, date range and status. Stored messages are already redacted.
export async function GET(req: Request) {
  try {
    await requireAdmin("system:view");
    const url = new URL(req.url);
    const q = url.searchParams;
    const where: Prisma.ErrorEventWhereInput = {};
    if (q.get("severity")) where.severity = q.get("severity") as ErrorSeverity;
    if (q.get("category")) where.category = q.get("category") as ErrorCategory;
    if (q.get("status")) where.status = q.get("status") as ErrorEventStatus;
    if (q.get("environment")) where.environment = q.get("environment")!;
    if (q.get("service")) where.service = q.get("service")!;
    const from = q.get("from") ? new Date(q.get("from")!) : null;
    const to = q.get("to") ? new Date(q.get("to")!) : null;
    if ((from && !isNaN(from.getTime())) || (to && !isNaN(to.getTime()))) {
      where.lastSeenAt = { ...(from && !isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !isNaN(to.getTime()) ? { lte: to } : {}) };
    }
    const page = Math.max(1, Number(q.get("page")) || 1);
    const [items, total] = await Promise.all([
      prisma.errorEvent.findMany({ where, orderBy: { lastSeenAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
      prisma.errorEvent.count({ where }),
    ]);
    return NextResponse.json({ items, total, page, pageSize: 25 });
  } catch (error) {
    return handleApiError(error);
  }
}
