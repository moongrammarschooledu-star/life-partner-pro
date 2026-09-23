import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { useEmergencyOverride } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";
import type { AssignmentResourceType } from "@prisma/client";

// STEP 19 §25 — Super-Admin-only (approvals:emergency-override is granted
// only to SUPER_ADMIN in permissions.ts). Requires fresh password
// re-confirmation, a mandatory reason and category, and always creates a
// mandatory post-action review task — never a silent bypass of logging.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("approvals:emergency-override");
    const body = (await req.json()) as {
      actionType?: string;
      sourceType?: AssignmentResourceType;
      sourceId?: string;
      reason?: string;
      category?: string;
      evidenceReference?: string;
      reauthToken?: string;
    };

    if (!body.actionType) throw new ApiError(400, "actionType is required.");
    if (!body.sourceType || !body.sourceId) throw new ApiError(400, "sourceType and sourceId are required.");
    if (!body.category?.trim()) throw new ApiError(400, "An emergency category is required.");
    const reason = requireReason(body.reason, 10);

    const request = await useEmergencyOverride({
      actionType: body.actionType,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      actorId: admin.id,
      reason,
      category: body.category.trim(),
      evidenceReference: body.evidenceReference,
      reauthToken: body.reauthToken,
    });

    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
