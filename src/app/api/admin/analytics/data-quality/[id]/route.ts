import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { setIssueStatus } from "@/lib/analytics/data-quality";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Status: OPEN | INVESTIGATING | RESOLVED | IGNORED_WITH_REASON (a reason is required to ignore).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:data_quality:manage");
    await assertEnabled();
    const { id } = await params;
    const b = await readBody(req);
    const status = String(b.status ?? "");
    if (!["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED_WITH_REASON"].includes(status)) throw new HttpError(400, "Unknown status.");
    const row = await setIssueStatus(admin, id, status as "OPEN" | "INVESTIGATING" | "RESOLVED" | "IGNORED_WITH_REASON", str(b, "reason", { max: 300 }));
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (error) {
    return marketingError(error);
  }
}
