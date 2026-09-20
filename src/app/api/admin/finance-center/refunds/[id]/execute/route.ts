import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { executeRefund } from "@/lib/finance/refund";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Spec §23/§57 — full financial control stays SUPER_ADMIN, and any
// financial override this high-risk requires password reauth (reusing the
// existing admin step-up-token primitive, same as break-glass access in
// STEP 13) — never a hidden bypass.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "refund-execute", 10, 600000);
  if (limited) return limited;
  try {
    const admin = await requireAdmin("finance:payments:manage");
    const { id } = await params;
    const { reauthToken } = (await req.json()) as { reauthToken?: string };

    if (!verifyStepUpToken(reauthToken, "REAUTH", admin.id)) {
      throw new ApiError(403, "Password re-confirmation is required to execute a refund.");
    }

    await executeRefund(id, admin.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
