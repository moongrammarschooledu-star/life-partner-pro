import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { listMarketingLeads } from "@/lib/marketing/marketing-lead-service";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";
import type { LeadStatus } from "@prisma/client";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:leads:view");
    const { cursor, take } = pageParams(req.url);
    const q = new URL(req.url).searchParams;
    const from = q.get("from") ? new Date(q.get("from") as string) : undefined;
    const to = q.get("to") ? new Date(q.get("to") as string) : undefined;
    const result = await listMarketingLeads(admin, {
      status: (q.get("status") as LeadStatus | null) ?? undefined, campaignId: q.get("campaignId") ?? undefined, source: q.get("source") ?? undefined,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined, to: to && !Number.isNaN(to.getTime()) ? to : undefined, cursor, take,
    });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
