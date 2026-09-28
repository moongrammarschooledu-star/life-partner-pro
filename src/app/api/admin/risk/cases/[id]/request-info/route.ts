import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { runCaseAction, caseActionResponse, type CaseActionBody } from "@/lib/risk/case-route";

// STEP 24 - asks the applicant for additional information (neutral notice; nothing about detection logic is
// revealed) or, with kind REVERIFICATION, routes them through the existing re-verification flow.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:review");
    const { id } = await params;
    const body = await readJson<CaseActionBody & { kind?: string }>(req);
    const action = body.kind === "REVERIFICATION" ? "REQUEST_REVERIFICATION" : "REQUEST_INFORMATION";
    return caseActionResponse(await runCaseAction(id, admin, action, body, action === "REQUEST_REVERIFICATION" ? { requireReasonText: true } : {}));
  } catch (error) {
    return handleApiError(error);
  }
}

export const dynamic = "force-dynamic";
