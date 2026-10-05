import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

// Provider webhook delivery log (statuses and reasons only — payloads are never stored or returned).
export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:providers:view");
    const { cursor, take } = pageParams(req.url);
    const status = new URL(req.url).searchParams.get("status");
    const rows = await prisma.marketingWebhookEvent.findMany({
      where: status ? { status: status as never } : {}, orderBy: { id: "desc" }, take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, providerKey: true, source: true, status: true, eventType: true, rejectReason: true, receivedAt: true, processedAt: true },
    });
    const page = rows.slice(0, take);
    return NextResponse.json({ items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
