import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { assertStepUp, invalidateSessionPolicy } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { getSocSettings, listConfigVersions, updateSocSettings, SOC_SETTINGS_FIELDS } from "@/lib/soc/settings";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

// Security configuration and its full change history. Thresholds, rate limits, backup retention and the two-factor roles already live in
// System Control / Settings; this screen links to them rather than duplicating them.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:config:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const s = await getSocSettings();
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "configuration" });
    return NextResponse.json({ version: s.version, settings: Object.fromEntries(SOC_SETTINGS_FIELDS.map((f) => [f, s[f]])), history: await listConfigVersions(50) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// PATCH { changes: { field: value }, reason, stepUpToken } — versioned, audited, reason required, password re-confirmation required.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("soc:config:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const b = await readBody(req, 5_000);
    await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "configuration" });
    const next = await updateSocSettings(admin.id, (b.changes && typeof b.changes === "object" ? b.changes : {}) as Record<string, unknown>, str(b, "reason", { required: true, max: 300 }));
    invalidateSessionPolicy();
    return NextResponse.json({ version: next.version, settings: Object.fromEntries(SOC_SETTINGS_FIELDS.map((f) => [f, next[f]])) });
  } catch (error) {
    return marketingError(error);
  }
}
