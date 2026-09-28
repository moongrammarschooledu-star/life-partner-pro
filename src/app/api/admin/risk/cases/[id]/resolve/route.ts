import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { runCaseAction, caseActionResponse, type CaseActionBody } from "@/lib/risk/case-route";

// STEP 24 - dismiss a case or mark it a false positive (a structured reason is required). The case and its
// history are kept; nothing is deleted.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:resolve");
    const { id } = await params;
    const body = await readJson<CaseActionBody>(req);
    if (body.decision !== "DISMISS" && body.decision !== "MARK_FALSE_POSITIVE") throw new ApiError(400, "decision must be DISMISS or MARK_FALSE_POSITIVE.");
    return caseActionResponse(await runCaseAction(id, admin, body.decision, body, { requireReasonText: true }));
  } catch (error) {
    return handleApiError(error);
  }
}

export const dynamic = "force-dynamic";
