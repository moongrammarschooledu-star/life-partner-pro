import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { isSameOrigin } from "@/lib/marketing/origin";
import { requireMobileActor } from "@/lib/mobile/auth";
import { resolveDeepLink } from "@/lib/mobile/deep-link-service";

export const dynamic = "force-dynamic";

// "May the app open this link?" The caller may be signed out (then the answer is "sign in first"). The answer is a path the application already serves; every
// reason for refusal looks the same (NOT_FOUND). The link itself is never treated as permission.
export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
    const limited = await enforceConfiguredLimit(req, "mobile-deep-link", { limit: 60, windowMs: 60_000 });
    if (limited) return limited;
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    const actor = await requireMobileActor();
    const result = await resolveDeepLink(actor, body?.url);
    return NextResponse.json(result, { status: result.allowed ? 200 : result.reason === "SIGN_IN_REQUIRED" ? 401 : 404 });
  } catch (error) {
    return handleApiError(error);
  }
}