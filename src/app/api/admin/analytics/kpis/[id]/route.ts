import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { advanceKpi, newKpiVersion, setKpiTarget } from "@/lib/analytics/kpi-service";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// PATCH { action: NEW_VERSION | SUBMIT | APPROVE | ACTIVATE | SUSPEND | RETIRE | TARGET, ... }. A formula change always makes a new
// version (history is kept); approving needs someone other than the author.
const PERMISSION = { NEW_VERSION: "analytics:kpi:create", SUBMIT: "analytics:kpi:create", TARGET: "analytics:kpi:manage", APPROVE: "analytics:kpi:manage", ACTIVATE: "analytics:kpi:manage", SUSPEND: "analytics:kpi:manage", RETIRE: "analytics:kpi:manage" } as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await readBody(req);
    const action = String(b.action ?? "");
    if (!(action in PERMISSION)) throw new HttpError(400, "Unknown action.");
    const admin = await requireAdmin(PERMISSION[action as keyof typeof PERMISSION]);
    await assertEnabled();
    if (action === "NEW_VERSION") return NextResponse.json(await newKpiVersion(admin, id, { formula: b.formula, direction: str(b, "direction", { max: 16 }) || undefined, frequency: str(b, "frequency", { max: 12 }) || undefined, changeSummary: str(b, "changeSummary", { required: true, max: 300 }) }));
    if (action === "TARGET") {
      const t = await setKpiTarget(admin, id, { frequency: str(b, "frequency", { required: true, max: 12 }), targetValue: Number(b.targetValue), warningThreshold: b.warningThreshold === null || b.warningThreshold === undefined ? null : Number(b.warningThreshold), criticalThreshold: b.criticalThreshold === null || b.criticalThreshold === undefined ? null : Number(b.criticalThreshold) });
      return NextResponse.json({ id: t.id });
    }
    return NextResponse.json(await advanceKpi(admin, id, action as "SUBMIT" | "APPROVE" | "ACTIVATE" | "SUSPEND" | "RETIRE", str(b, "reason", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
