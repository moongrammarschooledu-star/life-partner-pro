import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { completeDrill, getDrill, recordItem, type DrillItemStatus } from "@/lib/soc/restore-drills";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:backups:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "restore-drill", resourceId: id });
    return NextResponse.json(await getDrill(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// PATCH { action: ITEM | COMPLETE, ... } — only the person who performed the drill (the service enforces it). Review is a separate route.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:restore:record");
    await assertSocEnabled("soc.restore_drills.enabled");
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 5_000);
    const action = str(b, "action", { required: true, max: 10 });
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "restore-drill", resourceId: id });
    if (action === "ITEM") return NextResponse.json(await recordItem(admin.id, id, str(b, "key", { required: true, max: 40 }), str(b, "status", { required: true, max: 10 }) as DrillItemStatus, str(b, "note", { max: 400 })));
    if (action === "COMPLETE") return NextResponse.json(await completeDrill(admin.id, id, str(b, "failureNote", { max: 400 })));
    throw new HttpError(422, "Unknown action.");
  } catch (error) {
    return marketingError(error);
  }
}
