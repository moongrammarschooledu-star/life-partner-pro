import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { exportMarketingLeads } from "@/lib/marketing/marketing-lead-service";
import { marketingError } from "@/lib/marketing/route-utils";
import type { LeadStatus } from "@prisma/client";

// CSV export (formula-injection neutralised, capped, audited). Contact columns additionally need
// sensitive:marketing:lead_contact:view and a STEP 19 approval; without them the file has no personal details at all.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:leads:export");
    const q = new URL(req.url).searchParams;
    const outcome = await exportMarketingLeads(admin, { status: (q.get("status") as LeadStatus | null) ?? undefined, campaignId: q.get("campaignId") ?? undefined }, { includeContact: q.get("includeContact") === "true", reason: q.get("reason") ?? "" });
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return new NextResponse(outcome.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=marketing-leads.csv", "Cache-Control": "no-store", "X-Export-Truncated": String(outcome.truncated) } });
  } catch (error) {
    return marketingError(error);
  }
}
