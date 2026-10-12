import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { cancelPendingOrder } from "@/lib/finance/order-cancel";
import { HttpError } from "@/lib/http-error";

// The signed-in applicant withdraws THEIR OWN unpaid order (no bank-transfer reference submitted yet). The order is looked up by order code AND the
// signed-in profile, so another person's order code answers 404, the same as an unknown one.
export async function POST(req: Request, { params }: { params: Promise<{ orderCode: string }> }) {
  try {
    const limited = await enforcePersistentLimit(req, "billing-cancel-order", 10, 60000);
    if (limited) return limited;
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const { orderCode } = await params;
    const result = await cancelPendingOrder({ profileId, orderCode });
    return NextResponse.json({ ok: true, orderCode: result.orderCode });
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Could not cancel the order. Please try again." }, { status: 500 });
  }
}
