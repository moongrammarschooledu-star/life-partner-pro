import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { runCaseAction, caseActionResponse, type CaseActionBody } from "@/lib/risk/case-route";

// STEP 24 - Applies scoped, time-boxed restrictions. Needs the review checklist, a reason, password re-confirmation and the STEP 19 approval gate (PERMANENT_RESTRICTION when permanent).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:restrict");
    const { id } = await params;
    const body = await readJson<CaseActionBody>(req);
    return caseActionResponse(await runCaseAction(id, admin, "RESTRICT", body, { reauth: true }));
  } catch (error) {
    return handleApiError(error);
  }
}

export const dynamic = "force-dynamic";
