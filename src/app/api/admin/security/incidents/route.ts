import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { applyTechnicalControl, expireDueControls } from "@/lib/risk/technical-controls";
import type { SecurityIncidentControl } from "@prisma/client";

const CONTROLS: SecurityIncidentControl[] = ["SESSION_REVOCATION", "SUBJECT_THROTTLE", "IP_BLOCK", "OTP_THROTTLE", "LOGIN_PROTECTION"];
const SUBJECTS = ["PROFILE", "ADMIN", "IP_HASH", "SUBJECT_KEY"] as const;

// STEP 24 - emergency TECHNICAL controls against an active attack. Always expiring (max 24 h), always a named
// person with a reason and a fresh password re-confirmation, always audited - and explicitly "not a decision
// about the person": these throttle or revoke access paths and never restrict or suspend a profile.
export async function GET() {
  try {
    await requireAdmin("security:incidents:manage");
    await expireDueControls();
    const items = await prisma.securityIncident.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return NextResponse.json({ items, note: "Technical controls are temporary and are not a decision about any person." });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("security:incidents:manage");
    const body = await readJson<{ controlType?: string; subjectType?: string; subjectRef?: unknown; reason?: unknown; durationMinutes?: unknown; riskCaseId?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "apply a technical control");
    if (!CONTROLS.includes(body.controlType as SecurityIncidentControl)) throw new ApiError(400, "A valid control type is required.");
    if (!SUBJECTS.includes(body.subjectType as (typeof SUBJECTS)[number])) throw new ApiError(400, "A valid subject type is required.");
    if (typeof body.subjectRef !== "string") throw new ApiError(400, "A subject is required.");
    const incident = await applyTechnicalControl({
      controlType: body.controlType as SecurityIncidentControl,
      subjectType: body.subjectType as (typeof SUBJECTS)[number],
      subjectRef: body.subjectRef,
      reason: typeof body.reason === "string" ? body.reason : "",
      durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : undefined,
      riskCaseId: typeof body.riskCaseId === "string" ? body.riskCaseId : null,
      actor: admin,
    });
    return NextResponse.json({ id: incident.id, expiresAt: incident.expiresAt }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
