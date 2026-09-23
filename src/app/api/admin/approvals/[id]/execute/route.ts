import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { markApprovalExecuted, markApprovalExecutionFailed } from "@/lib/approvals/engine";

const EXECUTE_PERMISSIONS = ["approvals:execute", "finance:approval:execute", "privacy:approval:execute", "security:approval:execute", "ai:approval:execute", "sensitive:approval:execute"] as const;

// STEP 19 §36 — manual "mark executed" entry point for catalog actions that
// don't (yet) have a live gate.ts insertion in their own route (see the
// STEP 19 plan's architecture decision 6): the admin performs the actual
// domain action through its existing screen, then confirms it here so the
// approval's lifecycle closes out and is audited. Idempotent — calling this
// twice on an already-EXECUTED request is a no-op (markApprovalExecuted()).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    if (!EXECUTE_PERMISSIONS.some((p) => admin.permissions.includes(p))) {
      throw new ApiError(403, "Forbidden: insufficient permissions");
    }
    const { id } = await params;
    try {
      const updated = await markApprovalExecuted(id, admin.id);
      return NextResponse.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      await markApprovalExecutionFailed(id, admin.id, message).catch(() => {});
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
