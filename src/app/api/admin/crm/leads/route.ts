import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createLead, listLeads } from "@/lib/crm/lead-service";
import type { LeadSource, LeadStatus } from "@prisma/client";

export async function GET(req: Request) {
  try {
    await requireAdmin("crm:leads:view");
    const q = new URL(req.url).searchParams;
    const items = await listLeads({
      ...(q.get("status") ? { status: q.get("status") as LeadStatus } : {}),
      ...(q.get("assignedStaffId") ? { assignedStaffId: q.get("assignedStaffId") as string } : {}),
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:leads:manage");
    const body = (await req.json()) as {
      fullName?: string; email?: string; phone?: string; city?: string; area?: string;
      inquiry?: string; source?: LeadSource; campaign?: string; consentGiven?: boolean;
    };
    if (!body.fullName?.trim()) throw new ApiError(400, "fullName is required.");
    if (!body.source) throw new ApiError(400, "source is required.");

    const lead = await createLead({ ...body, fullName: body.fullName, source: body.source, createdById: admin.id });
    return NextResponse.json(lead, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
