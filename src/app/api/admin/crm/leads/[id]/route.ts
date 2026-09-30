import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { updateLeadStatus, assignLead } from "@/lib/crm/lead-service";
import type { LeadStatus } from "@prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("crm:leads:view");
    const { id } = await params;
    const lead = await prisma.lead.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "desc" } } } });
    if (!lead) throw new ApiError(404, "Lead not found.");
    return NextResponse.json(lead);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:leads:manage");
    const { id } = await params;
    const body = (await req.json()) as { status?: LeadStatus; reason?: string; assignedStaffId?: string };

    if (body.assignedStaffId) {
      const updated = await assignLead(id, body.assignedStaffId, admin.id);
      return NextResponse.json(updated);
    }
    if (body.status) {
      const updated = await updateLeadStatus(id, body.status, { actorId: admin.id, reason: body.reason });
      return NextResponse.json(updated);
    }
    throw new ApiError(400, "Either status or assignedStaffId must be provided.");
  } catch (error) {
    return handleApiError(error);
  }
}
