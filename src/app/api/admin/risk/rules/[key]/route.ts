import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { gatedConfigChange } from "@/lib/risk/config-route";
import { isRuleKey, setRule, validateRuleConfig } from "@/lib/risk/config";

const THRESHOLD_KEYS = ["score_bands", "case_policy", "scoring"];

// Version history of one rule (newest first).
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    await requireAdmin("risk:rules:view");
    const { key } = await params;
    if (!isRuleKey(key)) throw new ApiError(404, "Unknown risk rule.");
    const versions = await prisma.riskRule.findMany({ where: { ruleKey: key }, orderBy: { version: "desc" }, take: 25 });
    return NextResponse.json({ key, versions: versions.map((v) => ({ ...v, configuration: safeJson(v.configuration) })) });
  } catch (error) {
    return handleApiError(error);
  }
}

// STEP 24 - change a detection rule. The change is validated (known fields only, type/range-checked, no sensitive
// traits), needs a reason + password re-confirmation, goes through the RISK_RULE_CHANGE approval gate and is stored
// as version N+1. Threshold-type rules are changed through /configuration instead.
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("risk:rules:manage");
    const { key } = await params;
    if (!isRuleKey(key)) throw new ApiError(404, "Unknown risk rule.");
    if (THRESHOLD_KEYS.includes(key)) throw new ApiError(400, "Threshold rules are managed under risk configuration.");
    const body = await readJson<{ config?: unknown; reason?: unknown; stepUpToken?: string; jurisdictionScope?: unknown }>(req);
    if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) throw new ApiError(400, "config is required.");
    const config = validateRuleConfig(key, body.config as Record<string, unknown>); // reject before creating any approval
    const scope = typeof body.jurisdictionScope === "string" && /^[A-Z_]{2,16}$/.test(body.jurisdictionScope) ? body.jurisdictionScope : "GLOBAL";
    return await gatedConfigChange({
      admin,
      actionType: "RISK_RULE_CHANGE",
      sourceId: `risk-rule:${key}:${scope}`,
      reason: body.reason,
      stepUpToken: body.stepUpToken,
      what: "change a risk rule",
      requestedPayload: { ruleKey: key, config, scope },
      apply: async () => {
        const created = await setRule({ ruleKey: key, config, actorId: admin.id, jurisdictionScope: scope, reason: String(body.reason).trim().slice(0, 500) });
        return { ruleKey: created.ruleKey, version: created.version };
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
