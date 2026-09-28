import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { RULE_DEFINITIONS, FACTOR_DEFINITIONS, getEffectiveRule, getEffectiveFactor, type RuleKey } from "@/lib/risk/config";

// Threshold-type rules are managed under /configuration (they have their own permission and approval type).
const THRESHOLD_RULE_KEYS: RuleKey[] = ["score_bands", "case_policy", "scoring"];

// STEP 24 - the versioned rules and factors currently in force (effective value + version + shipped default).
// Read-only; changes are made through the gated PATCH routes and always create a new version.
export async function GET() {
  try {
    await requireAdmin("risk:rules:view");
    const keys = Object.keys(RULE_DEFINITIONS) as RuleKey[];
    const rules = await Promise.all(
      keys.map(async (key) => {
        const def = RULE_DEFINITIONS[key];
        const effective = await getEffectiveRule(key);
        return { key, name: def.name, category: def.category, description: def.description, defaults: def.defaults, effective: effective.config, version: effective.version, threshold: THRESHOLD_RULE_KEYS.includes(key) };
      })
    );
    const factors = await Promise.all(
      Object.keys(FACTOR_DEFINITIONS).map(async (key) => {
        const f = await getEffectiveFactor(key);
        return { key, name: f.name, category: f.category, weight: f.weight, defaultWeight: FACTOR_DEFINITIONS[key].weight, severity: f.severity, enabled: f.enabled, immediateControl: f.immediateControl, version: f.version };
      })
    );
    const recent = await prisma.riskRule.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { ruleKey: true, version: true, status: true, jurisdictionScope: true, effectiveFrom: true, createdById: true } });
    return NextResponse.json({ rules, factors, recentChanges: recent });
  } catch (error) {
    return handleApiError(error);
  }
}
