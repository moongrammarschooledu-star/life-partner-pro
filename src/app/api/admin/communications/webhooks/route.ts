import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { takeParam } from "@/lib/communications/route-utils";

// The webhook ledger: what providers have told us, whether each event was accepted, and why any were rejected.
// Payload bodies are not stored in the ledger (only a hash), so nothing sensitive can be read back from here.
export async function GET(req: Request) {
  try {
    await requireAdmin("communications:webhooks:view");
    const q = new URL(req.url).searchParams;
    const items = await prisma.webhookEvent.findMany({
      where: { ...(q.get("channel") ? { channel: q.get("channel") as never } : {}), ...(q.get("status") ? { status: q.get("status") as string } : {}) },
      orderBy: { createdAt: "desc" },
      take: takeParam(q.get("take")),
      select: { id: true, provider: true, channel: true, eventType: true, providerMessageId: true, providerEventId: true, status: true, signatureValid: true, failureReason: true, attempts: true, createdAt: true, processedAt: true },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
