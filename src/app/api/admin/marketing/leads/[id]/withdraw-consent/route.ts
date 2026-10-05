import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { withdrawLeadConsent } from "@/lib/marketing/consent-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Records a lead's withdrawal of marketing consent (e.g. they asked by phone). Also suppresses marketing to their contact
// details, because withdrawal has to actually stop outreach.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:leads:manage");
    const { id } = await params;
    const b = await readBody(req);
    const lead = await prisma.lead.findUnique({ where: { id }, select: { campaignId: true, platform: true } });
    if (!lead || (!lead.campaignId && !lead.platform)) throw new HttpError(404, "Marketing lead not found.");
    return NextResponse.json(await withdrawLeadConsent(id, { actorId: admin.id, reason: str(b, "reason", { required: true, max: 300 }) }));
  } catch (error) {
    return marketingError(error);
  }
}
