import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { resolveDuplicateCluster } from "@/lib/risk/duplicate-cluster-service";
import type { FalsePositiveReason } from "@prisma/client";

const REASONS: FalsePositiveReason[] = ["SHARED_FAMILY_DEVICE", "SHARED_FAMILY_PHONE", "SHARED_HOME_NETWORK", "DATA_ENTRY_ERROR", "PROVIDER_ERROR", "LEGITIMATE_DUPLICATE_CONTEXT", "INCORRECT_SIGNAL", "OTHER"];

// STEP 24 - human resolution of a cluster. FALSE_POSITIVE needs a structured reason (and records why, so the
// pair is never re-flagged); CONFIRMED goes through the STEP 19 DUPLICATE_CONFIRMATION gate (202 while pending).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:resolve");
    const { id } = await params;
    const body = await readJson<{ decision?: string; note?: unknown; falsePositiveReason?: string }>(req);
    if (body.decision !== "CONFIRMED" && body.decision !== "FALSE_POSITIVE" && body.decision !== "RESOLVED") throw new ApiError(400, "decision must be CONFIRMED, FALSE_POSITIVE or RESOLVED.");
    if (body.falsePositiveReason !== undefined && !REASONS.includes(body.falsePositiveReason as FalsePositiveReason)) throw new ApiError(400, "Invalid false-positive reason.");
    const result = await resolveDuplicateCluster(id, admin, {
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : "",
      falsePositiveReason: body.falsePositiveReason as FalsePositiveReason | undefined,
    });
    if (result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode, status: result.status }, { status: 202 });
    return NextResponse.json({ approvalRequired: false, cluster: { id: result.cluster.id, status: result.cluster.status } });
  } catch (error) {
    return handleApiError(error);
  }
}
