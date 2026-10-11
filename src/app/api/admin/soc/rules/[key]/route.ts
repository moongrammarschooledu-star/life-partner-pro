import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { assertStepUp } from "@/lib/soc/session-policy";
import { logSocAccess } from "@/lib/soc/audit";
import { proposeRuleChange, ruleHistory } from "@/lib/soc/rule-service";
import { HttpError } from "@/lib/http-error";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { RuleConfig } from "@/lib/soc/types";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("soc:rules:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { key } = await params;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "rule", resourceId: key });
    return NextResponse.json({ versions: await ruleHistory(key) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// PATCH { patch: { enabled?, severity?, threshold?, windowMinutes? }, reason, stepUpToken }. A change that makes a high-severity or protected
// rule quieter is saved as PROPOSED and only takes effect when a DIFFERENT person approves it (see /review).
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("soc:rules:manage");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { key } = await params;
    const b = await readBody(req, 10_000);
    await assertStepUp(admin.id, str(b, "stepUpToken", { max: 600 }));
    const raw = (b.patch ?? {}) as Record<string, unknown>;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "patch must be an object.");
    const patch: Partial<RuleConfig> = {};
    for (const k of Object.keys(raw)) {
      if (!["enabled", "severity", "threshold", "windowMinutes"].includes(k)) throw new HttpError(422, `Unknown setting: ${k}.`);
    }
    if (raw.enabled !== undefined) patch.enabled = raw.enabled as boolean;
    if (raw.severity !== undefined) patch.severity = raw.severity as RuleConfig["severity"];
    if (raw.threshold !== undefined) patch.threshold = raw.threshold as number;
    if (raw.windowMinutes !== undefined) patch.windowMinutes = raw.windowMinutes as number;
    await logSocAccess({ adminId: admin.id, action: "CHANGE", resource: "rule", resourceId: key });
    return NextResponse.json(await proposeRuleChange(await currentViewer(admin.id), key, patch, str(b, "reason", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
