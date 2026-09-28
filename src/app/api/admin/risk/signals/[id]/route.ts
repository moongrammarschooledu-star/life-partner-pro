import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { resolveRiskSignal } from "@/lib/risk/signal-service";
import type { FalsePositiveReason, SecurityFlagStatus } from "@prisma/client";

const REVIEW_STATUSES: SecurityFlagStatus[] = ["ACKNOWLEDGED", "INVESTIGATING", "ESCALATED"];
const DECISION_STATUSES: SecurityFlagStatus[] = ["RESOLVED", "DISMISSED", "FALSE_POSITIVE", "CONFIRMED", "ARCHIVED"];
const REASONS: FalsePositiveReason[] = ["SHARED_FAMILY_DEVICE", "SHARED_FAMILY_PHONE", "SHARED_HOME_NETWORK", "DATA_ENTRY_ERROR", "PROVIDER_ERROR", "LEGITIMATE_DUPLICATE_CONTEXT", "INCORRECT_SIGNAL", "OTHER"];

// The device / network signal types are context-only and privacy-sensitive: they are hidden from reviewers who do
// not hold the matching sensitive:* permission (the same 404 as a missing signal).
const DEVICE_TYPES = ["SHARED_DEVICE_SIGNAL"];
const NETWORK_TYPES = ["UNUSUAL_NETWORK_ACTIVITY"];

async function loadVisibleFlag(id: string, permissions: string[]) {
  const flag = await prisma.securityFlag.findUnique({
    where: { id },
    include: {
      profile: { select: { id: true, profileCode: true, fullName: true } },
      assignedTo: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
  });
  if (!flag) throw new ApiError(404, "Risk signal not found");
  if (DEVICE_TYPES.includes(flag.flagType) && !permissions.includes("sensitive:device:view")) throw new ApiError(404, "Risk signal not found");
  if (NETWORK_TYPES.includes(flag.flagType) && !permissions.includes("sensitive:network:view")) throw new ApiError(404, "Risk signal not found");
  return flag;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:view");
    const { id } = await params;
    return NextResponse.json(await loadVisibleFlag(id, admin.permissions));
  } catch (error) {
    return handleApiError(error);
  }
}

// STEP 24 - human review / resolution of a single signal. Reviewing needs risk:review; a decision (resolve,
// dismiss, false positive, confirm, archive) needs risk:resolve, a written note, and - for a false positive - a
// structured reason. Only a person can reach these states: adminId is mandatory in resolveRiskSignal().
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:review");
    const { id } = await params;
    const body = await readJson<{ status?: string; resolution?: unknown; falsePositiveReason?: string }>(req);
    const status = body.status as SecurityFlagStatus;
    if (!REVIEW_STATUSES.includes(status) && !DECISION_STATUSES.includes(status)) throw new ApiError(400, "A valid status is required.");
    if (DECISION_STATUSES.includes(status) && !admin.permissions.includes("risk:resolve")) throw new ApiError(403, "Forbidden: insufficient permissions");
    if (body.falsePositiveReason !== undefined && !REASONS.includes(body.falsePositiveReason as FalsePositiveReason)) throw new ApiError(400, "Invalid false-positive reason.");
    await loadVisibleFlag(id, admin.permissions);
    const updated = await resolveRiskSignal({
      flagId: id,
      status,
      adminId: admin.id,
      resolution: typeof body.resolution === "string" ? body.resolution : undefined,
      falsePositiveReason: body.falsePositiveReason as FalsePositiveReason | undefined,
    });
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (error) {
    return handleApiError(error);
  }
}
