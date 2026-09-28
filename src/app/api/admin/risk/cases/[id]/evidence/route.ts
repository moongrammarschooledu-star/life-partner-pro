import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { addEvidence, listEvidence } from "@/lib/risk/evidence-service";
import type { RiskEvidenceType } from "@prisma/client";

const TYPES: RiskEvidenceType[] = [
  "VERIFICATION_RESULT", "AUDIT_EVENT", "LOGIN_EVENT", "SECURITY_EVENT", "PROFILE_CHANGE", "CONTACT_CHANGE", "API_EVENT", "PAYMENT_EVENT", "SUPPORT_CASE", "USER_REPORT", "ADMIN_NOTE", "PROVIDER_RESULT",
];

// STEP 24 - case evidence. Listing is a logged sensitive access; the redacted payload is only returned to holders
// of sensitive:evidence:view. Evidence is append-only (no update / delete endpoint exists) and integrity-hashed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:evidence:view");
    const { id } = await params;
    const withPayload = admin.permissions.includes("sensitive:evidence:view");
    const rows = await listEvidence(id, admin);
    return NextResponse.json({ items: rows.map((r) => ({ ...r, payload: withPayload ? r.payload : undefined })) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:evidence:manage");
    const { id } = await params;
    const body = await readJson<{ evidenceType?: string; source?: unknown; summary?: unknown; payload?: unknown; occurredAt?: unknown }>(req);
    if (!TYPES.includes(body.evidenceType as RiskEvidenceType)) throw new ApiError(400, "A valid evidence type is required.");
    if (typeof body.summary !== "string") throw new ApiError(400, "An evidence summary is required.");
    const occurredAt = typeof body.occurredAt === "string" && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt) : undefined;
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : undefined;
    const evidence = await addEvidence({
      riskCaseId: id,
      actor: admin,
      evidenceType: body.evidenceType as RiskEvidenceType,
      source: typeof body.source === "string" && body.source.trim() ? body.source : "admin",
      summary: body.summary,
      payload,
      occurredAt,
    });
    return NextResponse.json({ id: evidence.id, contentHash: evidence.contentHash }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
