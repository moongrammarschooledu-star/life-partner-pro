import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { shareDashboard } from "@/lib/analytics/dashboard-service";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Sharing re-validates every widget against the SHARER's own access: a dashboard can never expose more than its sharer can see.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:dashboard:share");
    await assertEnabled();
    const { id } = await params;
    const b = await readBody(req);
    const scope = String(b.scope ?? "");
    if (!["PRIVATE", "TEAM", "DEPARTMENT", "ORGANIZATION"].includes(scope)) throw new HttpError(400, "Unknown share scope.");
    await shareDashboard(admin, id, scope as "PRIVATE" | "TEAM" | "DEPARTMENT" | "ORGANIZATION", str(b, "scopeValue", { max: 60 }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return marketingError(error);
  }
}
