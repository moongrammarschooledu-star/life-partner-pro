import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getMarketingLead } from "@/lib/marketing/marketing-lead-service";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// The attribution record and timeline for one lead. Deliberately returns neither contact details nor the lead record —
// attribution access does not imply contact access.
export async function GET(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const admin = await requireAdmin("marketing:attribution:view");
    const { leadId } = await params;
    const d = await getMarketingLead({ ...admin, permissions: admin.permissions.filter((p) => p !== "sensitive:marketing:lead_contact:view") }, leadId);
    return NextResponse.json({ leadCode: d.lead.leadCode, campaignCode: d.lead.campaignCode, attribution: d.attribution, timeline: d.timeline }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
