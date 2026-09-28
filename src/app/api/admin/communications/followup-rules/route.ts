import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { loadFollowUpRules, validateFollowUpRule } from "@/lib/communications/followup-automation";
import { readJson, str } from "@/lib/communications/route-utils";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { clearCommunicationPolicyCache } from "@/lib/communications/policy-config";

export async function GET() {
  try {
    await requireAdmin("communications:providers:view");
    return NextResponse.json({ rules: await loadFollowUpRules() });
  } catch (error) {
    return handleApiError(error);
  }
}

// Follow-up automation rules ship DISABLED; enabling or tuning one is a versioned, reasoned, audited change.
export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const body = await readJson(req);
    const key = str(body.ruleKey, "ruleKey", { max: 60 });
    const rule = validateFollowUpRule(key, body.rule);
    const reason = str(body.reason, "reason", { max: 300 });
    const latest = await prisma.communicationPolicy.findFirst({ where: { kind: "FOLLOWUP_RULE", policyKey: key, jurisdictionScope: "GLOBAL" }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    await prisma.$transaction([
      prisma.communicationPolicy.updateMany({ where: { kind: "FOLLOWUP_RULE", policyKey: key, jurisdictionScope: "GLOBAL", status: "ACTIVE" }, data: { status: "SUPERSEDED" } }),
      prisma.communicationPolicy.create({ data: { kind: "FOLLOWUP_RULE", policyKey: key, version, configuration: JSON.stringify(rule), status: "ACTIVE", jurisdictionScope: "GLOBAL", createdById: admin.id } }),
    ]);
    clearCommunicationPolicyCache();
    await writeAudit({ action: "COMMUNICATION_POLICY_CHANGED", adminId: admin.id, meta: { kind: "FOLLOWUP_RULE", policyKey: key, version, enabled: rule.enabled, reason: reason.slice(0, 300) } });
    return NextResponse.json({ ruleKey: key, version, rule });
  } catch (error) {
    return handleApiError(error);
  }
}
