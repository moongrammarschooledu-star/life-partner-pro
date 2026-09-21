import { z } from "zod";
import type { AiRolloutPhase, AiRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { auditAi } from "@/lib/ai/record";
import { getAiConfig, invalidateAiConfig, DEFAULT_AI_CONFIG, DEFAULT_RATE_LIMITS, type AiConfigValues } from "@/lib/ai/config";
import { externalKeyPresent } from "@/lib/ai/providers";
import { runRuntimeSuite, RUNTIME_CHECK_COUNT } from "@/lib/ai/testing/suite";
import { AI_VERSION, MATCH_ALGORITHM_VERSION, PROMPT_VERSIONS, TEST_SUITE_VERSION, type AiFeatureKey } from "@/lib/ai/versions";
import { allPromptChecksums, promptFor } from "@/lib/ai/prompts";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";

// Spec §22/§56/§58/§59/§66 — administration of the AI layer. Secrets are never
// stored or returned (the external key lives only in the environment). Every
// change is validated, recorded in AiConfigHistory and audited; provider /
// model / prompt / rollout moves forward require a FRESH passing test run.

const FEATURE_KEYS = Object.keys(PROMPT_VERSIONS) as [AiFeatureKey, ...AiFeatureKey[]];
const STORAGE = z.enum(["DO_NOT_STORE", "SUMMARY_ONLY", "FULL_RESULT", "LIMITED_PERIOD"]);

export const configPatchSchema = z
  .object({
    provider: z.enum(["RULES", "ANTHROPIC", "DISABLED"]).optional(),
    externalProviderAllowed: z.boolean().optional(),
    model: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxOutputTokens: z.number().int().min(100).max(4000).optional(),
    timeoutMs: z.number().int().min(2000).max(60_000).optional(),
    retryCount: z.number().int().min(0).max(3).optional(),
    dailyRequestCap: z.number().int().min(0).max(1_000_000).optional(),
    monthlyRequestCap: z.number().int().min(0).max(10_000_000).optional(),
    rateLimits: z.record(z.string().max(60), z.object({ limit: z.number().int().min(1).max(1000), windowSec: z.number().int().min(60).max(86_400) })).optional(),
    storageModes: z.partialRecord(z.enum(FEATURE_KEYS), STORAGE).optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
    cacheTtlMinutes: z.number().int().min(1).max(1440).optional(),
    pilotAdminIds: z.array(z.string().trim().min(8).max(64)).max(50).optional(),
    priceInputPerMTokUsd: z.number().min(0).max(1000).nullable().optional(),
    priceOutputPerMTokUsd: z.number().min(0).max(1000).nullable().optional(),
  })
  .strict();
export type ConfigPatch = z.infer<typeof configPatchSchema>;

// ---------------------------------------------------------------------------
// Tests gate (spec §66)
// ---------------------------------------------------------------------------

const TEST_MAX_AGE_DAYS = 14;

export async function latestPassingRun(now: Date = new Date()) {
  const run = await prisma.aiTestRun.findFirst({ where: { suite: "all", status: "PASS", testVersion: TEST_SUITE_VERSION, createdAt: { gt: new Date(now.getTime() - TEST_MAX_AGE_DAYS * 86_400_000) } }, orderBy: { createdAt: "desc" } });
  if (!run) return null;
  // The run only counts if the prompts have not changed since it was made.
  const current = allPromptChecksums();
  const recorded = (run.promptVersions as Record<string, string> | null) ?? {};
  return Object.keys(current).every((k) => recorded[k] === current[k]) ? run : null;
}

async function requirePassingTests(what: string): Promise<void> {
  if (!(await latestPassingRun())) throw new ApiError(409, `Run and pass the AI test suite before ${what}. (Admin → AI Assistant → AI Settings → Run tests)`);
}

export async function runTests(admin: SessionAdmin, suite = "all") {
  const cfg = await getAiConfig();
  const r = runRuntimeSuite(suite);
  const row = await prisma.aiTestRun.create({
    data: {
      suite,
      testVersion: TEST_SUITE_VERSION,
      provider: cfg.provider,
      model: cfg.model,
      promptVersions: allPromptChecksums(),
      passed: r.passed,
      failed: r.failed,
      status: r.failed === 0 ? "PASS" : "FAIL",
      failures: r.failures as unknown as Prisma.InputJsonValue,
      triggeredById: admin.id,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
  });
  await auditAi("AI_CONFIGURATION_CHANGED", admin.id, { kind: "TEST_RUN", suite, status: row.status, passed: r.passed, failed: r.failed, testRunId: row.id });
  return { id: row.id, ...r, status: row.status };
}

export async function listTestRuns(limit = 20) {
  return prisma.aiTestRun.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, suite: true, testVersion: true, provider: true, model: true, passed: true, failed: true, status: true, failures: true, commitSha: true, createdAt: true } });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export async function getConfigView() {
  const cfg = await getAiConfig();
  return {
    config: cfg,
    externalKeyPresent: externalKeyPresent(), // a boolean only — the key itself is never readable
    defaults: { rateLimits: DEFAULT_RATE_LIMITS },
    versions: { ai: AI_VERSION, matchAlgorithm: MATCH_ALGORITHM_VERSION, testSuite: TEST_SUITE_VERSION },
    features: FEATURE_KEYS,
  };
}

async function writeConfig(data: Partial<AiConfigValues> & Record<string, unknown>, updatedById: string) {
  const { rateLimits, storageModes, ...rest } = data;
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  const create = { id: 1, ...rest, ...(rateLimits !== undefined ? { rateLimits: json(rateLimits) } : {}), ...(storageModes !== undefined ? { storageModes: json(storageModes) } : {}), updatedById };
  await prisma.aiConfig.upsert({ where: { id: 1 }, update: { ...rest, ...(rateLimits !== undefined ? { rateLimits: json(rateLimits) } : {}), ...(storageModes !== undefined ? { storageModes: json(storageModes) } : {}), updatedById } as never, create: create as never });
  invalidateAiConfig();
}

export async function updateConfig(admin: SessionAdmin, patch: ConfigPatch, reason: string) {
  const before = await getAiConfig();
  const changed = Object.keys(patch) as Array<keyof ConfigPatch>;
  if (changed.length === 0) throw new ApiError(400, "Nothing to change.");

  const providerChange = patch.provider !== undefined && patch.provider !== before.provider;
  const modelChange = patch.model !== undefined && patch.model !== before.model;
  const enablingExternal = (patch.provider === "ANTHROPIC" && providerChange) || (patch.externalProviderAllowed === true && !before.externalProviderAllowed);
  if (providerChange || modelChange || enablingExternal || patch.storageModes) {
    // Any move that alters what runs, or what is kept, needs a fresh passing suite (spec §66).
    await requirePassingTests("changing the provider, model, storage policy or external access");
  }

  const beforeSubset: Record<string, unknown> = {};
  const afterSubset: Record<string, unknown> = {};
  for (const k of changed) {
    beforeSubset[k] = (before as unknown as Record<string, unknown>)[k];
    afterSubset[k] = patch[k];
  }
  await writeConfig(patch as never, admin.id);
  await prisma.aiConfigHistory.create({ data: { actorAdminId: admin.id, kind: providerChange || modelChange ? "MODEL" : "CONFIG", before: beforeSubset as Prisma.InputJsonValue, after: afterSubset as Prisma.InputJsonValue, reason } });
  await auditAi("AI_CONFIGURATION_CHANGED", admin.id, { kind: providerChange || modelChange ? "MODEL" : "CONFIG", keys: changed, reason });
  return getConfigView();
}

// ---------------------------------------------------------------------------
// Rollout phases and kill switch (spec §58/§59)
// ---------------------------------------------------------------------------

const NEXT: Record<AiRolloutPhase, AiRolloutPhase[]> = {
  DISABLED: ["INTERNAL_TEST"],
  INTERNAL_TEST: ["STAFF_PILOT", "DISABLED"],
  STAFF_PILOT: ["LIMITED_PRODUCTION", "INTERNAL_TEST", "DISABLED"],
  LIMITED_PRODUCTION: ["PRODUCTION", "STAFF_PILOT", "DISABLED"],
  PRODUCTION: ["LIMITED_PRODUCTION", "DISABLED"],
};
const ORDER: AiRolloutPhase[] = ["DISABLED", "INTERNAL_TEST", "STAFF_PILOT", "LIMITED_PRODUCTION", "PRODUCTION"];

export function validTransition(from: AiRolloutPhase, to: AiRolloutPhase): boolean {
  return from !== to && NEXT[from].includes(to);
}

export async function setRolloutPhase(admin: SessionAdmin, to: AiRolloutPhase, reason: string) {
  const cfg = await getAiConfig();
  if (!validTransition(cfg.phase, to)) throw new ApiError(400, `The phase cannot move from ${cfg.phase} to ${to}. Phases advance one step at a time; any phase can return to DISABLED.`);
  const upward = ORDER.indexOf(to) > ORDER.indexOf(cfg.phase);
  if (upward && to !== "INTERNAL_TEST") await requirePassingTests("moving AI beyond internal testing");
  await writeConfig({ phase: to }, admin.id);
  await prisma.aiConfigHistory.create({ data: { actorAdminId: admin.id, kind: "ROLLOUT", before: { phase: cfg.phase }, after: { phase: to }, reason } });
  await auditAi("AI_ROLLOUT_CHANGED", admin.id, { from: cfg.phase, to, reason });
  return { from: cfg.phase, to };
}

export async function setKillSwitch(admin: SessionAdmin, active: boolean, reason: string) {
  const cfg = await getAiConfig();
  await writeConfig({ killSwitchActive: active, killSwitchReason: active ? reason : null, killSwitchAt: active ? new Date() : null }, admin.id);
  await prisma.aiConfigHistory.create({ data: { actorAdminId: admin.id, kind: "KILL_SWITCH", before: { active: cfg.killSwitchActive }, after: { active }, reason } });
  await auditAi("AI_KILL_SWITCH_USED", admin.id, { active, previouslyActive: cfg.killSwitchActive, reason });
  return { active };
}

// ---------------------------------------------------------------------------
// Prompts (spec §65/§66)
// ---------------------------------------------------------------------------

export async function listPrompts() {
  const rows = await prisma.aiPromptVersion.findMany({ where: { active: true } });
  return (Object.keys(PROMPT_VERSIONS) as AiFeatureKey[]).map((f) => {
    const p = promptFor(f);
    const active = rows.find((r) => r.promptId === PROMPT_VERSIONS[f]);
    return { feature: f, id: p.id, checksum: p.checksum, approved: !!active && active.checksum === p.checksum, activatedAt: active?.createdAt ?? null };
  });
}

export async function approvePrompts(admin: SessionAdmin, reason: string) {
  const run = await latestPassingRun();
  if (!run) throw new ApiError(409, "Run and pass the AI test suite before approving prompts.");
  for (const f of Object.keys(PROMPT_VERSIONS) as AiFeatureKey[]) {
    const p = promptFor(f);
    await prisma.aiPromptVersion.upsert({
      where: { promptId_version: { promptId: PROMPT_VERSIONS[f], version: p.checksum } },
      update: { active: true, testRunId: run.id, activatedById: admin.id },
      create: { promptId: PROMPT_VERSIONS[f], version: p.checksum, feature: f, checksum: p.checksum, active: true, testRunId: run.id, activatedById: admin.id },
    });
  }
  await prisma.aiConfigHistory.create({ data: { actorAdminId: admin.id, kind: "PROMPT", before: undefined, after: allPromptChecksums() as Prisma.InputJsonValue, reason } });
  await auditAi("AI_CONFIGURATION_CHANGED", admin.id, { kind: "PROMPT", testRunId: run.id, reason });
}

// ---------------------------------------------------------------------------
// Usage, activity, health (spec §24/§60/§68/§69)
// ---------------------------------------------------------------------------

export async function usageReport(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.aiRequest.findMany({ where: { createdAt: { gte: since } }, select: { actorAdminId: true, feature: true, status: true, provider: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, costIsEstimate: true, latencyMs: true } });
  const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, { requests: number; success: number; failed: number; blocked: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k) ?? { requests: 0, success: 0, failed: 0, blocked: 0 };
      e.requests++;
      if (r.status === "SUCCESS" || r.status === "FALLBACK") e.success++;
      else if (r.status === "FAILED") e.failed++;
      else if (r.status === "BLOCKED_SAFETY") e.blocked++;
      m.set(k, e);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.requests - a.requests);
  };
  const names = new Map((await prisma.adminUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorAdminId))] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const priced = rows.filter((r) => r.costIsEstimate && r.estimatedCostUsd != null);
  const tokens = rows.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
  return {
    days,
    totals: { requests: rows.length, success: rows.filter((r) => r.status === "SUCCESS" || r.status === "FALLBACK").length, failed: rows.filter((r) => r.status === "FAILED").length, blocked: rows.filter((r) => r.status === "BLOCKED_SAFETY").length, denied: rows.filter((r) => r.status === "DENIED").length },
    tokens: tokens > 0 ? tokens : null, // null = the provider reported none (e.g. the built-in provider)
    estimatedCostUsd: priced.length ? Math.round(priced.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0) * 1e6) / 1e6 : null,
    costNote: priced.length ? "Estimated from provider-reported token usage and the configured price; not an invoice." : "No cost is shown: the built-in provider has no per-request cost, and no provider-reported usage plus price is configured.",
    byFeature: by((r) => r.feature),
    byProvider: by((r) => r.provider),
    byAdmin: by((r) => r.actorAdminId).map((e) => ({ ...e, name: names.get(e.key) ?? "Unknown" })),
  };
}

export const activityFilterSchema = z.object({
  adminId: z.string().max(64).optional(),
  feature: z.string().max(40).optional(),
  status: z.string().max(30).optional(),
  provider: z.string().max(20).optional(),
  model: z.string().max(80).optional(),
  days: z.coerce.number().int().min(1).max(365).default(7),
  safetyOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function activityList(f: z.infer<typeof activityFilterSchema>) {
  const where: Prisma.AiRequestWhereInput = {
    createdAt: { gte: new Date(Date.now() - f.days * 86_400_000) },
    ...(f.adminId ? { actorAdminId: f.adminId } : {}),
    ...(f.feature ? { feature: f.feature as never } : {}),
    ...(f.status ? { status: f.status as AiRequestStatus } : {}),
    ...(f.provider ? { provider: f.provider as never } : {}),
    ...(f.model ? { model: f.model } : {}),
    ...(f.safetyOnly ? { status: "BLOCKED_SAFETY" } : {}),
  };
  const rows = await prisma.aiRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: f.limit,
    // Metadata only — request/result text is never in this table.
    select: { id: true, actorAdminId: true, actorRole: true, feature: true, status: true, provider: true, model: true, promptVersion: true, aiVersion: true, matchAlgorithmVersion: true, latencyMs: true, errorCode: true, fromCache: true, consentOutcome: true, correlationId: true, createdAt: true },
  });
  const names = new Map((await prisma.adminUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorAdminId))] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const safety = await prisma.aiSafetyEvent.findMany({ where: { createdAt: { gte: new Date(Date.now() - f.days * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, rule: true, action: true, feature: true, createdAt: true } });
  return { items: rows.map((r) => ({ ...r, actorName: names.get(r.actorAdminId) ?? "Unknown" })), safetyEvents: safety };
}

export type AiHealthStatus = "DISABLED" | "OK" | "DEGRADED" | "DOWN";

export function classifyHealth(cfg: Pick<AiConfigValues, "phase" | "killSwitchActive" | "provider">, hour: { requests: number; failures: number }): AiHealthStatus {
  if (cfg.killSwitchActive || cfg.phase === "DISABLED" || cfg.provider === "DISABLED") return "DISABLED";
  if (hour.requests >= 5) {
    const rate = hour.failures / hour.requests;
    if (rate >= 0.8) return "DOWN";
    if (rate >= 0.3) return "DEGRADED";
  }
  return "OK";
}

export async function healthReport() {
  const cfg = await getAiConfig();
  const hourAgo = new Date(Date.now() - 3_600_000);
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);
  const [reqHour, failHour, req24, blocked24, denied24, lastOk, lastFail, latency, safety24] = await Promise.all([
    prisma.aiRequest.count({ where: { createdAt: { gte: hourAgo }, status: { in: ["SUCCESS", "FALLBACK", "FAILED"] } } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: hourAgo }, status: { in: ["FAILED", "FALLBACK"] } } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: dayAgo }, status: "BLOCKED_SAFETY" } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: dayAgo }, status: "DENIED" } }),
    prisma.aiRequest.findFirst({ where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.aiRequest.findFirst({ where: { status: { in: ["FAILED", "FALLBACK"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, errorCode: true } }),
    prisma.aiRequest.aggregate({ where: { createdAt: { gte: dayAgo }, latencyMs: { not: null } }, _avg: { latencyMs: true } }),
    prisma.aiSafetyEvent.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);
  const flags = await getAllFeatureFlags();
  return {
    status: classifyHealth(cfg, { requests: reqHour, failures: failHour }),
    phase: cfg.phase,
    killSwitchActive: cfg.killSwitchActive,
    provider: cfg.provider,
    model: cfg.model,
    externalKeyPresent: externalKeyPresent(),
    externalActive: cfg.provider === "ANTHROPIC" && cfg.externalProviderAllowed && externalKeyPresent(),
    lastHour: { requests: reqHour, failures: failHour },
    last24h: { requests: req24, blocked: blocked24, denied: denied24, safetyEvents: safety24, avgLatencyMs: latency._avg.latencyMs != null ? Math.round(latency._avg.latencyMs) : null },
    lastSuccessAt: lastOk?.createdAt ?? null,
    lastFailure: lastFail ? { at: lastFail.createdAt, code: lastFail.errorCode } : null,
    enabledFeatures: Object.entries(flags).filter(([k, v]) => k.startsWith("ai.") && v).map(([k]) => k),
    note: "Health reflects real requests only. No request in the last hour means no rate is shown, not that everything is healthy.",
  };
}

export async function overview() {
  const [cfg, health, usage, tests] = await Promise.all([getConfigView(), healthReport(), usageReport(1), listTestRuns(1)]);
  const passing = await latestPassingRun();
  return {
    phase: cfg.config.phase,
    provider: cfg.config.provider,
    model: cfg.config.model,
    killSwitchActive: cfg.config.killSwitchActive,
    externalKeyPresent: cfg.externalKeyPresent,
    versions: cfg.versions,
    health,
    today: usage.totals,
    latestTest: tests[0] ?? null,
    testsCurrentlyValid: !!passing,
    runtimeChecks: RUNTIME_CHECK_COUNT,
    honestyNote: "AI recommends and explains; humans decide. The compatibility score always comes from the deterministic matching engine.",
    defaults: DEFAULT_AI_CONFIG.phase,
  };
}
