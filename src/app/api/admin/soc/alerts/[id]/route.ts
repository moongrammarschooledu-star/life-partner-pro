import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { addAlertNote, assignAlert, changeAlertStatus, getAlert } from "@/lib/soc/alerts";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { SocAlertStatus } from "@prisma/client";

const TARGETS = ["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE", "ESCALATED", "CLOSED"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:alerts:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const alert = await getAlert(id);
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "alert", resourceId: id });
    return NextResponse.json(alert, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// PATCH { action: STATUS | ASSIGN | NOTE, ... } — the person acting is always the signed-in administrator; the body never names an actor.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:alerts:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 10_000);
    const viewer = await currentViewer(admin.id);
    const action = str(b, "action", { required: true, max: 12 });
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "alert", resourceId: id });
    if (action === "STATUS") {
      const to = str(b, "to", { required: true, max: 20 });
      if (!TARGETS.includes(to)) throw new HttpError(422, "Unknown status.");
      return NextResponse.json(await changeAlertStatus(viewer, id, to as SocAlertStatus, str(b, "note", { max: 600 })));
    }
    if (action === "ASSIGN") return NextResponse.json(await assignAlert(viewer, id, str(b, "assigneeId", { max: 40 }) || null));
    if (action === "NOTE") {
      await addAlertNote(viewer, id, str(b, "note", { required: true, max: 600 }));
      return NextResponse.json({ ok: true });
    }
    throw new HttpError(422, "Unknown action.");
  } catch (error) {
    return marketingError(error);
  }
}
