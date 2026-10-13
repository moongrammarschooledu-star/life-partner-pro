import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { isSameOrigin } from "@/lib/marketing/origin";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { requireMobileActor, type MobileActor } from "@/lib/mobile/auth";

// Shared guard for the signed-in mobile endpoints: the app must be switched on, a state-changing request must come from this site's own pages (the app is a
// web view of the site), the caller is rate limited, and they must hold a valid applicant or family session. Anything else answers the same neutral 401.
export async function mobileGuard(req: Request, limitName: string, limit: { limit: number; windowMs: number }, options: { write?: boolean } = {}): Promise<{ actor: MobileActor } | { response: NextResponse }> {
  if (!(await isFeatureEnabled("mobile.app.enabled"))) return { response: NextResponse.json({ error: "The app is temporarily unavailable." }, { status: 503 }) };
  if (options.write && !isSameOrigin(req)) return { response: NextResponse.json({ error: "Request not allowed." }, { status: 403 }) };
  const actor = await requireMobileActor();
  if (!actor) return { response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const limited = await enforceConfiguredLimit(req, limitName, limit, actor.kind === "PROFILE" ? actor.profileId : actor.familyMemberId);
  if (limited) return { response: limited };
  return { actor };
}