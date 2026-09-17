import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { grantBreakGlass, type BreakGlassRecordType } from "@/lib/privacy/break-glass";

// Spec §31 — SUPER_ADMIN + step-up reauth to create; scoped narrowly to
// contact reveal and case/privacy-incident access only (confirmed scope),
// not a hidden platform-wide bypass. Reuses the existing admin
// password-reauth token (/api/admin/auth/reauth), same as other
// high-risk admin actions in this codebase.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("privacy:break-glass:manage");
    const { reason, recordType, recordId, reauthToken } = (await req.json()) as {
      reason?: string; recordType?: BreakGlassRecordType; recordId?: string; reauthToken?: string;
    };

    if (!verifyStepUpToken(reauthToken, "REAUTH", admin.id)) {
      throw new ApiError(403, "Password re-confirmation is required for emergency access.");
    }
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");
    if (recordType !== "CONTACT" && recordType !== "CASE") throw new ApiError(400, "Invalid record type.");
    if (!recordId) throw new ApiError(400, "recordId is required.");

    const grant = await grantBreakGlass({ adminId: admin.id, reason, recordType, recordId });
    return NextResponse.json(grant);
  } catch (error) {
    return handleApiError(error);
  }
}
