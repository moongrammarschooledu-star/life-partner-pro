import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { advanceMetric, setMetricOwner } from "@/lib/analytics/catalog-service";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// POST { action: SUBMIT | APPROVE | ACTIVATE | SUSPEND | RETIRE | REACTIVATE | OWNER, reason }. Approval needs someone other than the author/owner.
const PERMISSION = { SUBMIT: "analytics:metrics:create", OWNER: "analytics:metrics:manage", APPROVE: "analytics:metrics:manage", ACTIVATE: "analytics:metrics:manage", SUSPEND: "analytics:metrics:manage", RETIRE: "analytics:metrics:manage", REACTIVATE: "analytics:metrics:manage" } as const;

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const b = await readBody(req);
    const action = String(b.action ?? "");
    if (!(action in PERMISSION)) throw new HttpError(400, "Unknown action.");
    const admin = await requireAdmin(PERMISSION[action as keyof typeof PERMISSION]);
    await assertEnabled();
    if (action === "OWNER") {
      await setMetricOwner(admin, key, (b.ownerAdminId as string | null | undefined) ?? null, str(b, "ownerLabel", { max: 80 }) || null);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await advanceMetric(admin, key, action as "SUBMIT" | "APPROVE" | "ACTIVATE" | "SUSPEND" | "RETIRE" | "REACTIVATE", str(b, "reason", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
