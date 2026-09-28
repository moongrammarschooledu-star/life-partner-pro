import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { gatedConfigChange } from "@/lib/risk/config-route";
import { RULE_DEFINITIONS, getEffectiveRule, setRule, validateRuleConfig, type RuleKey } from "@/lib/risk/config";
import { KNOWN_LIMITS, setRateLimitPolicy } from "@/lib/security/rate-limit-policy";

const THRESHOLD_KEYS: RuleKey[] = ["score_bands", "case_policy", "scoring"];

// STEP 24 - risk thresholds (score bands, automatic case-opening level, scoring on/off) and configurable rate-limit
// policies. Read-only view here; changes use PATCH.
export async function GET() {
  try {
    await requireAdmin("risk:configuration:view");
    const thresholds = await Promise.all(
      THRESHOLD_KEYS.map(async (key) => {
        const e = await getEffectiveRule(key);
        return { key, name: RULE_DEFINITIONS[key].name, description: RULE_DEFINITIONS[key].description, defaults: RULE_DEFINITIONS[key].defaults, effective: e.config, version: e.version };
      })
    );
    const policies = await prisma.rateLimitPolicy.findMany({ where: { status: "ACTIVE" }, orderBy: { policyKey: "asc" }, take: 100 });
    return NextResponse.json({ thresholds, rateLimitPolicies: policies, knownLimiters: KNOWN_LIMITS });
  } catch (error) {
    return handleApiError(error);
  }
}

// Threshold changes and rate-limit policy changes are RISK_THRESHOLD_CHANGE: versioned, reasoned, re-authenticated
// and approval-gated. Bounds are enforced server-side (a limiter can be tightened or relaxed up to 10x, never removed).
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("risk:configuration:manage");
    const body = await readJson<{ ruleKey?: string; config?: unknown; policyKey?: string; limit?: unknown; windowSeconds?: unknown; reason?: unknown; stepUpToken?: string }>(req);

    if (body.ruleKey) {
      if (!THRESHOLD_KEYS.includes(body.ruleKey as RuleKey)) throw new ApiError(400, "Not a threshold rule.");
      if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) throw new ApiError(400, "config is required.");
      const key = body.ruleKey as RuleKey;
      const config = validateRuleConfig(key, body.config as Record<string, unknown>);
      return await gatedConfigChange({
        admin,
        actionType: "RISK_THRESHOLD_CHANGE",
        sourceId: `risk-threshold:${key}`,
        reason: body.reason,
        stepUpToken: body.stepUpToken,
        what: "change a risk threshold",
        requestedPayload: { ruleKey: key, config },
        apply: async () => {
          const created = await setRule({ ruleKey: key, config, actorId: admin.id, reason: String(body.reason).trim().slice(0, 500) });
          return { ruleKey: created.ruleKey, version: created.version };
        },
      });
    }

    if (body.policyKey) {
      if (typeof body.limit !== "number" || typeof body.windowSeconds !== "number") throw new ApiError(400, "limit and windowSeconds are required numbers.");
      const policyKey = body.policyKey;
      const limit = body.limit;
      const windowSeconds = body.windowSeconds;
      return await gatedConfigChange({
        admin,
        actionType: "RISK_THRESHOLD_CHANGE",
        sourceId: `rate-limit:${policyKey}`,
        reason: body.reason,
        stepUpToken: body.stepUpToken,
        what: "change a rate-limit policy",
        requestedPayload: { policyKey, limit, windowSeconds },
        apply: async () => {
          const created = await setRateLimitPolicy({ policyKey, limit, windowSeconds, actorId: admin.id, reason: String(body.reason).trim().slice(0, 500) });
          return { policyKey: created.policyKey, version: created.version };
        },
      });
    }
    throw new ApiError(400, "Provide either ruleKey + config, or policyKey + limit + windowSeconds.");
  } catch (error) {
    return handleApiError(error);
  }
}
