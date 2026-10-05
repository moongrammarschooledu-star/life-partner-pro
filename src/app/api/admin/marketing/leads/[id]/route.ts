import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { getMarketingLead, toLeadDto, updateMarketingLeadStatus } from "@/lib/marketing/marketing-lead-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { LeadStatus } from "@prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:leads:view");
    const { id } = await params;
    return NextResponse.json(await getMarketingLead(admin, id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// Only the status (with a reason) is editable here; everything else on a lead is captured data or CRM-owned.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:leads:manage");
    const { id } = await params;
    const b = await readBody(req);
    const status = str(b, "status", { required: true }) as LeadStatus;
    const updated = await updateMarketingLeadStatus(admin, id, status, str(b, "reason", { required: true, max: 500 }));
    if (!updated) throw new HttpError(404, "Lead not found.");
    return NextResponse.json(toLeadDto(updated, admin.permissions));
  } catch (error) {
    return marketingError(error);
  }
}
