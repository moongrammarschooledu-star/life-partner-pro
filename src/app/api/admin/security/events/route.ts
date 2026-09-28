import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { Prisma, SecurityEventType } from "@prisma/client";

// STEP 24 - the security-event ledger (read-only). Network / device hashes are only returned to holders of
// sensitive:network:view / sensitive:device:view, events about the viewing admin are never listed to them, and the
// subject key (a salted hash of a pre-auth identifier) is never returned at all.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("security:events:view");
    const sp = new URL(req.url).searchParams;
    const eventType = sp.get("eventType");
    const from = sp.get("from");
    const to = sp.get("to");
    const take = Math.min(Math.max(Number(sp.get("take") ?? 50) || 50, 1), 100);
    const where: Prisma.SecurityEventWhereInput = {
      ...(eventType ? { eventType: eventType as SecurityEventType } : {}),
      ...(from || to ? { createdAt: { ...(from && !Number.isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}), ...(to && !Number.isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}) } } : {}),
      OR: [{ adminId: null }, { adminId: { not: admin.id } }],
    };
    const rows = await prisma.securityEvent.findMany({ where, orderBy: { createdAt: "desc" }, take });
    const network = admin.permissions.includes("sensitive:network:view");
    const device = admin.permissions.includes("sensitive:device:view");
    return NextResponse.json({
      items: rows.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        source: e.source,
        outcome: e.outcome,
        profileId: e.profileId,
        adminId: e.adminId,
        familyMemberId: e.familyMemberId,
        ipHash: network ? e.ipHash : undefined,
        userAgentHash: device ? e.userAgentHash : undefined,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
