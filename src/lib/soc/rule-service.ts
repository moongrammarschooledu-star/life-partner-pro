import type { SocRuleVersion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { socAudit } from "@/lib/soc/audit";
import { RULES, getRuleDefinition } from "@/lib/soc/rules/registry";
import { needsSecondReviewer, validateRuleConfig } from "@/lib/soc/rules/engine";
import { collectObservations } from "@/lib/soc/collect";
import { evaluateObservations } from "@/lib/soc/rules/engine";
import type { RuleConfig, RuleDefinition, SocViewer } from "@/lib/soc/types";

// STEP 32 — rule versions. A rule's DEFINITION is code; its tunable values are version rows:
//   ACTIVE (in force) · PROPOSED (a weakening change waiting for a second person) · SUPERSEDED · REJECTED.
// Anything that makes a high-severity or protected rule quieter (switch off, lower severity, higher threshold, shorter window) is PROPOSED
// and takes effect only when someone OTHER than its author approves it. Strengthening takes effect at once. Every step is audited.

const toConfig = (v: Pick<SocRuleVersion, "enabled" | "severity" | "threshold" | "windowMinutes">): RuleConfig => ({ enabled: v.enabled, severity: v.severity, threshold: v.threshold, windowMinutes: v.windowMinutes });

// Creates the rule rows (and their version 1 = the code defaults) the first time anyone needs them. Idempotent.
export async function ensureRules(): Promise<void> {
  const existing = new Set((await prisma.socDetectionRule.findMany({ select: { key: true } })).map((r) => r.key));
  for (const def of RULES) {
    if (existing.has(def.key)) continue;
    try {
      await prisma.socDetectionRule.create({
        data: { key: def.key, versions: { create: { version: 1, status: "ACTIVE", ...def.defaults, changeReason: "Default configuration shipped with the rule", authorId: null } } },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // two requests creating the same rule at once is fine
    }
  }
}

export interface RuleView {
  key: string;
  name: string;
  category: string;
  description: string;
  source: string;
  unit: string;
  protectedRule: boolean;
  defaults: RuleConfig;
  active: RuleConfig & { version: number };
  proposed: (RuleConfig & { version: number; authorId: string | null; changeReason: string; createdAt: Date }) | null;
}

export async function listRules(): Promise<RuleView[]> {
  await ensureRules();
  const rows = await prisma.socDetectionRule.findMany({ include: { versions: { orderBy: { version: "desc" } } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return RULES.map((def) => {
    const row = byKey.get(def.key);
    const active = row?.versions.find((v) => v.status === "ACTIVE");
    const proposed = row?.versions.find((v) => v.status === "PROPOSED");
    return {
      key: def.key, name: def.name, category: def.category, description: def.description, source: def.source, unit: def.unit, protectedRule: def.protectedRule, defaults: def.defaults,
      active: active ? { ...toConfig(active), version: active.version } : { ...def.defaults, version: 0 },
      proposed: proposed ? { ...toConfig(proposed), version: proposed.version, authorId: proposed.authorId, changeReason: proposed.changeReason, createdAt: proposed.createdAt } : null,
    };
  });
}

export async function ruleHistory(key: string) {
  if (!getRuleDefinition(key)) throw new HttpError(404, "Unknown rule.");
  await ensureRules();
  const rule = await prisma.socDetectionRule.findUnique({ where: { key }, include: { versions: { orderBy: { version: "desc" } } } });
  return rule?.versions ?? [];
}

// The configuration the detection run uses: the ACTIVE version (a PROPOSED one is never used until approved), else the code default.
export async function activeConfigs(): Promise<Map<string, RuleConfig & { version: number }>> {
  const rows = await prisma.socDetectionRule.findMany({ include: { versions: { where: { status: "ACTIVE" }, take: 1 } } });
  const out = new Map<string, RuleConfig & { version: number }>();
  for (const def of RULES) {
    const v = rows.find((r) => r.key === def.key)?.versions[0];
    out.set(def.key, v ? { ...toConfig(v), version: v.version } : { ...def.defaults, version: 0 });
  }
  return out;
}

async function nextVersion(ruleId: string): Promise<number> {
  const last = await prisma.socRuleVersion.findFirst({ where: { ruleId }, orderBy: { version: "desc" } });
  return (last?.version ?? 0) + 1;
}

export async function proposeRuleChange(actor: SocViewer, key: string, patch: Partial<RuleConfig>, reason: string): Promise<{ status: "ACTIVE" | "PROPOSED"; version: number }> {
  const def = getRuleDefinition(key);
  if (!def) throw new HttpError(404, "Unknown rule.");
  if (reason.trim().length < 5) throw new HttpError(422, "Say why the rule is changing (at least 5 characters).");
  await ensureRules();
  const rule = await prisma.socDetectionRule.findUniqueOrThrow({ where: { key } });
  const active = await prisma.socRuleVersion.findFirst({ where: { ruleId: rule.id, status: "ACTIVE" }, orderBy: { version: "desc" } });
  if (!active) throw new HttpError(409, "The rule has no active version.");
  if (await prisma.socRuleVersion.findFirst({ where: { ruleId: rule.id, status: "PROPOSED" } })) throw new HttpError(409, "A change to this rule is already waiting for review.");

  const prev = toConfig(active);
  const v = validateRuleConfig(patch, prev);
  if (!v.ok) throw new HttpError(422, v.error);
  const next = v.config;
  if (JSON.stringify(next) === JSON.stringify(prev)) throw new HttpError(422, "Nothing changed.");

  const review = needsSecondReviewer(def, prev, next);
  const version = await nextVersion(rule.id);
  await prisma.$transaction([
    ...(review ? [] : [prisma.socRuleVersion.updateMany({ where: { ruleId: rule.id, status: "ACTIVE" }, data: { status: "SUPERSEDED" } })]),
    prisma.socRuleVersion.create({ data: { ruleId: rule.id, version, status: review ? "PROPOSED" : "ACTIVE", ...next, changeReason: reason.trim().slice(0, 300), authorId: actor.id } }),
    ...(review ? [] : [prisma.socDetectionRule.update({ where: { id: rule.id }, data: { currentVersion: version } })]),
  ]);
  await socAudit({ action: "SOC_RULE_CHANGED", actorId: actor.id, resource: "rule", resourceId: key, before: prev, after: next, reason, extra: { version, status: review ? "PROPOSED" : "ACTIVE" } });
  return { status: review ? "PROPOSED" : "ACTIVE", version };
}

export async function reviewRuleChange(actor: SocViewer, key: string, decision: "APPROVE" | "REJECT", note: string): Promise<{ status: "ACTIVE" | "REJECTED"; version: number }> {
  if (!getRuleDefinition(key)) throw new HttpError(404, "Unknown rule.");
  if (note.trim().length < 3) throw new HttpError(422, "A short note is required.");
  const rule = await prisma.socDetectionRule.findUnique({ where: { key } });
  const proposed = rule ? await prisma.socRuleVersion.findFirst({ where: { ruleId: rule.id, status: "PROPOSED" } }) : null;
  if (!rule || !proposed) throw new HttpError(404, "There is no change waiting for review.");
  if (proposed.authorId === actor.id) throw new HttpError(403, "A change cannot be approved or rejected by the person who proposed it.");
  const now = new Date();
  if (decision === "APPROVE") {
    await prisma.$transaction([
      prisma.socRuleVersion.updateMany({ where: { ruleId: rule.id, status: "ACTIVE" }, data: { status: "SUPERSEDED" } }),
      prisma.socRuleVersion.update({ where: { id: proposed.id }, data: { status: "ACTIVE", reviewerId: actor.id, reviewedAt: now } }),
      prisma.socDetectionRule.update({ where: { id: rule.id }, data: { currentVersion: proposed.version } }),
    ]);
  } else {
    await prisma.socRuleVersion.update({ where: { id: proposed.id }, data: { status: "REJECTED", reviewerId: actor.id, reviewedAt: now } });
  }
  await socAudit({ action: "SOC_RULE_CHANGED", actorId: actor.id, resource: "rule", resourceId: key, after: { decision, version: proposed.version }, reason: note });
  return { status: decision === "APPROVE" ? "ACTIVE" : "REJECTED", version: proposed.version };
}

// ---- dry run: what WOULD this configuration have raised over a past window? Creates nothing (except the audit/access trail). ----
export interface DryRunResult {
  rule: string;
  from: string;
  to: string;
  config: RuleConfig;
  findings: number;
  sample: Array<{ resource: string; observed: number; summary: string }>;
  truncated: boolean;
}

export async function dryRunRule(actor: SocViewer, key: string, opts: { days?: number; config?: Partial<RuleConfig>; now?: Date } = {}): Promise<DryRunResult> {
  const def: RuleDefinition | undefined = getRuleDefinition(key);
  if (!def) throw new HttpError(404, "Unknown rule.");
  await ensureRules();
  const active = (await activeConfigs()).get(key)!;
  const merged = validateRuleConfig(opts.config ?? {}, { enabled: true, severity: active.severity, threshold: active.threshold, windowMinutes: active.windowMinutes });
  if (!merged.ok) throw new HttpError(422, merged.error);
  const cfg = { ...merged.config, enabled: true }; // a dry run always evaluates, even for a rule that is currently switched off
  const days = Math.min(Math.max(Math.trunc(opts.days ?? 7), 1), 30);
  const to = opts.now ?? new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const read = await collectObservations(def, from, to);
  const findings = evaluateObservations(def, read.observations, cfg);
  await socAudit({ action: "SOC_RULE_DRY_RUN", actorId: actor.id, resource: "rule", resourceId: key, after: { days, findings: findings.length, threshold: cfg.threshold, windowMinutes: cfg.windowMinutes } });
  return { rule: key, from: from.toISOString(), to: to.toISOString(), config: cfg, findings: findings.length, sample: findings.slice(0, 20).map((f) => ({ resource: f.resource, observed: f.observed, summary: f.summary })), truncated: read.truncated };
}

