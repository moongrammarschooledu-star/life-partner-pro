import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { activeAdminSessions, breakGlassUsage, loginSignals, mfaCoverage, privilegeChanges } from "@/lib/soc/admin-security";
import { getSocSettings } from "@/lib/soc/settings";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Administrator security: second-step coverage, live sessions (addresses masked), privilege changes, break-glass use and sign-in counts.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:admin_security:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const [mfa, sessions, changes, glass, logins, s] = await Promise.all([mfaCoverage(), activeAdminSessions(), privilegeChanges(30), breakGlassUsage(90), loginSignals(7), getSocSettings()]);
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "admin-security" });
    return NextResponse.json(
      { mfa, sessions, privilegeChanges: changes, breakGlass: glass, logins, policy: { sessionIdleMinutes: s.sessionIdleMinutes, maxConcurrentSessions: s.maxConcurrentSessions, stepUpForHighRisk: s.stepUpForHighRisk, enforceMfaPrivileged: s.enforceMfaPrivileged } },
      { headers: noStore },
    );
  } catch (error) {
    return marketingError(error);
  }
}
