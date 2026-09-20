import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { changeAlertStatus, openIncidentForAlert, evaluateAndSyncAlerts } from "@/lib/ops/alerts";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import type { AlertSeverity, AlertStatus, Prisma } from "@prisma/client";

const STATUSES: AlertStatus[] = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "MITIGATING", "RESOLVED", "CLOSED"];

export async function GET(req: Request) {
  try {
    await requireAdmin("alerts:view");
    const q = new URL(req.url).searchParams;
    const where: Prisma.AlertWhereInput = {};
    const status = q.get("status");
    if (status === "OPEN") where.status = { notIn: ["RESOLVED", "CLOSED"] };
    else if (status && (STATUSES as string[]).includes(status)) where.status = status as AlertStatus;
    if (q.get("severity")) where.severity = q.get("severity") as AlertSeverity;
    if (q.get("service")) where.service = q.get("service")!;

    const [items, open, admins] = await Promise.all([
      prisma.alert.findMany({ where, orderBy: [{ lastSeenAt: "desc" }], take: 50, include: { events: { orderBy: { createdAt: "desc" }, take: 20 } } }),
      prisma.alert.groupBy({ by: ["severity"], where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, _count: { _all: true } }),
      prisma.adminUser.findMany({ where: { active: true }, select: { id: true, name: true } }),
    ]);
    const cases = await prisma.case.findMany({ where: { id: { in: items.map((a) => a.incidentCaseId).filter((x): x is string => Boolean(x)) } }, select: { id: true, caseNumber: true, status: true } });
    return NextResponse.json({
      items: items.map((a) => ({ ...a, incident: cases.find((c) => c.id === a.incidentCaseId) ?? null, assignedTo: admins.find((u) => u.id === a.assignedToId)?.name ?? null })),
      openBySeverity: Object.fromEntries(open.map((o) => [o.severity, o._count._all])),
      admins,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("alerts:manage");
    const body = await readJson<{ alertId?: string; toStatus?: AlertStatus; note?: string; assignedToId?: string | null }>(req);
    if (!body.alertId) throw new ApiError(400, "An alert is required.");
    if (body.toStatus && !STATUSES.includes(body.toStatus)) throw new ApiError(400, "Invalid status.");
    const current = await prisma.alert.findUniqueOrThrow({ where: { id: body.alertId } });
    if ((body.toStatus === "RESOLVED" || body.toStatus === "CLOSED") && !body.note?.trim()) throw new ApiError(400, "A resolution note is required.");
    const updated = await changeAlertStatus({ alertId: body.alertId, toStatus: body.toStatus ?? current.status, actorId: admin.id, note: body.note, assignedToId: body.assignedToId });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

// Open an incident (Step 12 Case) for an alert, or run an evaluation now.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("alerts:manage");
    const limited = await enforcePersistentLimit(req, "admin-alerts", 20, 60_000, admin.id);
    if (limited) return limited;
    const body = await readJson<{ action?: string; alertId?: string }>(req);
    if (body.action === "open_incident" && body.alertId) return NextResponse.json(await openIncidentForAlert(body.alertId, admin.id));
    if (body.action === "evaluate") return NextResponse.json(await evaluateAndSyncAlerts());
    throw new ApiError(400, "Unknown action.");
  } catch (error) {
    return handleApiError(error);
  }
}
