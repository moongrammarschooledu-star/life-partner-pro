import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { addEvidence, addIncidentNote, getIncident, moveIncident, recordIncidentField, setOwner, type ReviewField } from "@/lib/soc/incidents";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { SocIncidentStatus } from "@prisma/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:incidents:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "incident", resourceId: id });
    return NextResponse.json(await getIncident(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// PATCH { action: MOVE | OWNER | FIELD | NOTE | EVIDENCE, ... }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("soc:incidents:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    const b = await readBody(req, 20_000);
    const viewer = await currentViewer(admin.id);
    const action = str(b, "action", { required: true, max: 10 });
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "incident", resourceId: id });
    if (action === "MOVE") return NextResponse.json(await moveIncident(viewer, id, str(b, "to", { required: true, max: 30 }) as SocIncidentStatus, str(b, "note", { max: 500 })));
    if (action === "OWNER") return NextResponse.json(await setOwner(viewer, id, str(b, "ownerId", { max: 40 }) || null));
    if (action === "FIELD") return NextResponse.json(await recordIncidentField(viewer, id, str(b, "field", { required: true, max: 20 }) as ReviewField, str(b, "value", { required: true, max: 2000 })));
    if (action === "NOTE") {
      await addIncidentNote(viewer, id, str(b, "note", { required: true, max: 800 }));
      return NextResponse.json({ ok: true });
    }
    if (action === "EVIDENCE") return NextResponse.json(await addEvidence(viewer, id, { type: str(b, "type", { required: true, max: 30 }), id: str(b, "refId", { required: true, max: 80 }), note: str(b, "note", { max: 200 }) }));
    throw new HttpError(422, "Unknown action.");
  } catch (error) {
    return marketingError(error);
  }
}
