import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { acknowledgeAlert, setAlertRuleStatus } from "@/lib/analytics/alerts";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody } from "@/lib/marketing/route-utils";

// PATCH { rule: true, status } changes a rule; PATCH { resolve?: boolean } acknowledges or resolves an alert EVENT with this id.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("analytics:alerts:manage");
    await assertEnabled();
    const { id } = await params;
    const b = await readBody(req);
    if (b.rule === true) {
      if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(String(b.status))) throw new HttpError(400, "Unknown status.");
      const r = await setAlertRuleStatus(admin, id, b.status as "ACTIVE" | "PAUSED" | "ARCHIVED");
      return NextResponse.json({ id: r.id, status: r.status });
    }
    const e = await acknowledgeAlert(admin, id, b.resolve === true);
    return NextResponse.json({ id: e.id, status: e.status });
  } catch (error) {
    return marketingError(error);
  }
}
