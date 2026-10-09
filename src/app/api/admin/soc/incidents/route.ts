import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { createIncident, listIncidents } from "@/lib/soc/incidents";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { SocIncidentCategory, SocIncidentStatus } from "@prisma/client";
import type { SocSeverity } from "@/lib/soc/types";

const STATUSES = ["OPEN", "DETECTED", "TRIAGED", "INVESTIGATING", "CONTAINMENT", "REMEDIATION", "RECOVERY", "POST_INCIDENT_REVIEW", "CLOSED"];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:incidents:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const status = new URL(req.url).searchParams.get("status") ?? "OPEN";
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "incidents" });
    return NextResponse.json({ items: await listIncidents({ status: STATUSES.includes(status) ? (status as SocIncidentStatus | "OPEN") : "OPEN" }) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// POST { title, category, severity, summary, ownerId?, alertIds? } — the creator is always the signed-in administrator.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("soc:incidents:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const b = await readBody(req, 20_000);
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "incident" });
    const incident = await createIncident(await currentViewer(admin.id), {
      title: str(b, "title", { required: true, max: 200 }),
      category: str(b, "category", { required: true, max: 40 }) as SocIncidentCategory,
      severity: str(b, "severity", { required: true, max: 10 }) as SocSeverity,
      summary: str(b, "summary", { required: true, max: 2000 }),
      ownerId: str(b, "ownerId", { max: 40 }) || null,
      alertIds: Array.isArray(b.alertIds) ? (b.alertIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : [],
    });
    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
