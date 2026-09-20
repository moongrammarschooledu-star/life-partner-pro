import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { readJson, requireReauth, requireReason } from "@/lib/ops/admin-route";
import { getSystemControl, invalidateSystemControl } from "@/lib/ops/system-control";
import { parseControlUpdate, sectionRequiresReauth, SECTION_PERMISSION, CONTROL_SECTIONS, type ControlSection } from "@/lib/ops/control-schema";
import type { AuditAction } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("system:view");
    return NextResponse.json(await getSystemControl());
  } catch (error) {
    return handleApiError(error);
  }
}

// One endpoint for every System Configuration tab. Each section has its own
// permission, high-risk sections need a fresh password re-confirmation, and a
// reason is mandatory for them — the audit row records previous + new values
// (safe scalar settings only; there are no secrets in SystemControl).
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{ section?: string; values?: unknown; reason?: string; stepUpToken?: string }>(req);
    const section = body.section as ControlSection;
    if (!CONTROL_SECTIONS.includes(section)) throw new ApiError(400, "Unknown configuration section.");
    if (!admin.permissions.includes(SECTION_PERMISSION[section])) throw new ApiError(403, "Forbidden: insufficient permissions");

    const parsed = parseControlUpdate(section, body.values);
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const data = { ...parsed.data };

    const highRisk = sectionRequiresReauth(section, data);
    const reason = highRisk ? requireReason(body.reason) : typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (highRisk) requireReauth(admin, body.stepUpToken, "change this system setting");

    if (section === "maintenance") {
      if (data.maintenanceStartsAt) data.maintenanceStartsAt = new Date(data.maintenanceStartsAt as string);
      if (data.maintenanceEndsAt) data.maintenanceEndsAt = new Date(data.maintenanceEndsAt as string);
      if (data.maintenanceMode === "SCHEDULED" && !data.maintenanceStartsAt) throw new ApiError(400, "A scheduled maintenance window needs a start time.");
    }

    const before = await getSystemControl();
    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(data)) previous[key] = (before as unknown as Record<string, unknown>)[key];

    await prisma.systemControl.upsert({ where: { id: 1 }, update: { ...data, updatedById: admin.id }, create: { id: 1, ...data, updatedById: admin.id } });
    invalidateSystemControl();

    let action: AuditAction = "SYSTEM_SETTING_CHANGED";
    if (section === "state") action = "OPERATIONAL_STATE_CHANGED";
    else if (section === "emergency") action = "EMERGENCY_SWITCH_CHANGED";
    else if (section === "session") action = "SECURITY_SETTINGS_CHANGED";
    else if (section === "maintenance") action = data.maintenanceMode === "OFF" ? "MAINTENANCE_DISABLED" : "MAINTENANCE_ENABLED";
    await writeAudit({ action, adminId: admin.id, meta: { section, previous, new: data, reason } });

    return NextResponse.json(await getSystemControl());
  } catch (error) {
    return handleApiError(error);
  }
}
