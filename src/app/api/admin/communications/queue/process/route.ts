import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { processCommunicationQueue } from "@/lib/communications/send-service";

// Drains due queued messages now (the daily tick does the same). Safe to call repeatedly: a row can only be claimed once.
export async function POST() {
  try {
    const admin = await requireAdmin("communications:send");
    const summary = await processCommunicationQueue({ limit: 100, budgetMs: 25_000 });
    await writeAudit({ action: "COMMUNICATION_QUEUE_PROCESSED", adminId: admin.id, meta: { manual: true, ...summary } });
    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
