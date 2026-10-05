import { NextResponse } from "next/server";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { GENERIC_FAILURE_MESSAGE, completeAdminPasswordReset, normaliseAdminEmail } from "@/lib/admin-password-reset";

export const dynamic = "force-dynamic";

// Public (pre-authentication). Completes a reset with the e-mailed code. Every wrong-code case (unknown e-mail, inactive
// account, no code issued, expired, used, too many attempts, wrong digits) returns the same generic 400. Throttled per IP and
// per e-mail; the code itself also allows only five wrong attempts.
export async function POST(req: Request) {
  let body: { email?: unknown; code?: unknown; newPassword?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const limited = await enforcePersistentLimit(req, "admin-reset-password", 10, 15 * 60_000, normaliseAdminEmail(body.email) ?? undefined);
  if (limited) return limited;

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await completeAdminPasswordReset({ email: body.email, code: body.code, newPassword: body.newPassword, ipAddress });
    if (result.ok) return NextResponse.json({ ok: true });
    if (result.reason === "weak_password") return NextResponse.json({ error: result.message }, { status: 400 });
    return NextResponse.json({ error: GENERIC_FAILURE_MESSAGE }, { status: 400 });
  } catch (error) {
    console.error("[admin-password-reset] completion failed", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
