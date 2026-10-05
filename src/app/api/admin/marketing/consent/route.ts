import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Aggregate consent evidence only — counts by purpose/channel, granted vs withdrawn. Lead-level consent is visible on
// the lead's own page. Nothing here identifies a person.
export async function GET() {
  try {
    await requireAdmin("marketing:consent:view");
    const [byPurpose, withdrawn, optedIn, total] = await Promise.all([
      prisma.marketingLeadConsent.groupBy({ by: ["purpose", "channel", "granted"], _count: { _all: true } }),
      prisma.marketingLeadConsent.count({ where: { withdrawnAt: { not: null } } }),
      prisma.lead.count({ where: { marketingOptIn: true } }),
      prisma.lead.count({ where: { OR: [{ campaignId: { not: null } }, { platform: { not: null } }] } }),
    ]);
    return NextResponse.json({ byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, channel: r.channel, granted: r.granted, count: r._count._all })), withdrawn, leadsWithMarketingOptIn: optedIn, marketingLeads: total, note: "Evidence only: a lead-form tick is never a profile-level marketing opt-in." }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
