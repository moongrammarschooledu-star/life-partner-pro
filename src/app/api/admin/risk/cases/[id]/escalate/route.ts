import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { runCaseAction, caseActionResponse, type CaseActionBody } from "@/lib/risk/case-route";

// STEP 24 - Escalates for senior review (a reason is required).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:escalate");
    const { id } = await params;
    const body = await readJson<CaseActionBody>(req);
    return caseActionResponse(await runCaseAction(id, admin, "ESCALATE", body, {}));
  } catch (error) {
    return handleApiError(error);
  }
}

export const dynamic = "force-dynamic";
