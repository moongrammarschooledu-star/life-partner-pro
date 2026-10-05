import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { MARKETING_SUPPRESSION_REASONS, suppressContact } from "@/lib/marketing/suppression";
import { marketingError, noStore, pageParams, readBody, str } from "@/lib/marketing/route-utils";
import type { CommunicationSuppressionReason } from "@prisma/client";

// The marketing suppression list (STEP 25's table, scope MARKETING/ALL). Entries are keyed by a salted hash, so the list
// itself holds no contact details; only a short reference (hash tail) is shown to identify an entry.
export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:suppression:view");
    const { cursor, take } = pageParams(req.url);
    const rows = await prisma.communicationSuppression.findMany({
      where: { scope: { in: ["ALL", "MARKETING"] } }, orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, channel: true, scope: true, reason: true, status: true, expiresAt: true, note: true, createdAt: true, destinationHash: true, profileId: true },
    });
    const page = rows.slice(0, take);
    return NextResponse.json({
      reasons: MARKETING_SUPPRESSION_REASONS,
      items: page.map(({ destinationHash, profileId, ...r }) => ({ ...r, ref: destinationHash ? destinationHash.slice(-6) : null, appliesToApplicant: !!profileId })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:suppression:manage");
    const b = await readBody(req);
    const reason = str(b, "reason", { required: true }) as CommunicationSuppressionReason;
    if (!MARKETING_SUPPRESSION_REASONS.includes(reason)) throw new HttpError(400, "Unsupported suppression reason.");
    const scope = b.scope === "ALL" ? "ALL" : "MARKETING";
    const created = await suppressContact({ phone: str(b, "phone", { max: 30 }) || null, email: str(b, "email", { max: 254 }) || null, reason, scope, note: str(b, "note", { max: 300 }) || null, actorId: admin.id });
    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
