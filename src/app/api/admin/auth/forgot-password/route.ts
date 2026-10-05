import { NextResponse } from "next/server";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { GENERIC_REQUEST_MESSAGE, normaliseAdminEmail, requestAdminPasswordReset } from "@/lib/admin-password-reset";

export const dynamic = "force-dynamic";

// Public (pre-authentication). Always answers the same 200 whether or not the e-mail is an admin account, so it cannot be
// used to discover which addresses exist. Throttled per IP and per e-mail on top of the per-account cooldown in the service.
export async function POST(req: Request) {
  let body: { email?: unknown } = {};
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const subject = normaliseAdminEmail(body.email) ?? undefined;
  const limited = await enforcePersistentLimit(req, "admin-forgot-password", 5, 15 * 60_000, subject);
  if (limited) return limited;

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await requestAdminPasswordReset(body.email, { ipAddress });
  } catch (error) {
    // Never reveal an internal failure either: it would distinguish "account exists" paths.
    console.error("[admin-password-reset] request failed", error instanceof Error ? error.message : "error");
  }
  return NextResponse.json({ ok: true, message: GENERIC_REQUEST_MESSAGE });
}
