import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { runCaseAction, caseActionResponse, type CaseActionBody } from "@/lib/risk/case-route";

// STEP 24 - Clears the case (a reason is required), resolves its signals and lifts the restrictions it applied.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:clear");
    const { id } = await params;
    const body = await readJson<CaseActionBody>(req);
    return caseActionResponse(await runCaseAction(id, admin, "CLEAR", body, { requireReasonText: true }));
  } catch (error) {
    return handleApiError(error);
  }
}

export const dynamic = "force-dynamic";
