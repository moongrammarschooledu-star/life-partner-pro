import type { AiFeature } from "@prisma/client";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";
import { rateLimitPersistent } from "@/lib/ops/rate-limit-persistent";
import { getRequestMeta } from "@/lib/observability/correlation";
import { getAiConfig, rateLimitFor, storageModeFor, type AiConfigValues } from "@/lib/ai/config";
import { evaluateAvailability, UNAVAILABLE_MESSAGE, type UnavailableReason } from "@/lib/ai/availability";
import { loadConsentDecision } from "@/lib/ai/consent";
import { loadAuthorizedProfiles, loadForbiddenStrings, restrictedCategoriesFor, type LoadedProfile } from "@/lib/ai/load";
import { selectProvider, rulesProvider } from "@/lib/ai/providers";
import { AiProviderError, type AIProviderAdapter, type ProviderResult, type ProviderSettings } from "@/lib/ai/providers/types";
import { applySafetyRules } from "@/lib/ai/safety";
import { clampPayload, validateLayout, payloadToStore, cacheableMode, expiryFor, cacheKey } from "@/lib/ai/store";
import { quotaExceeded, usageCounts, estimateCost } from "@/lib/ai/usage";
import { AI_VERSION, MATCH_ALGORITHM_VERSION, PROMPT_VERSIONS, type AiFeatureKey } from "@/lib/ai/versions";
import { AUDIT_FOR, auditAi, logAiAccess, readCachedPayload, recordRequest, recordSafetyEvents, storeResult, type RequestBase } from "@/lib/ai/record";
import type { AiFailureCode, AiLabels, AiOutcome, AiPayload } from "@/lib/ai/types";

// Spec §39 — the single entry point for every AI feature:
//   validateRequest → authorizeAdmin → checkConsent → loadAuthorizedData →
//   minimizeData → sanitizeInput → callAIProvider → validateOutput →
//   applySafetyRules → audit → returnResult
// (validation happens at the API edge with Zod; minimisation and sanitisation
// live in the feature builders via minimizeForExternal / wrapUntrusted.)
//
// AI never bypasses the existing authorization: STAFF row scoping, sensitive
// field permissions, consent and restrictions are all enforced before any
// provider is called, and a provider failure never breaks the core app.

export interface BuildContext {
  provider: AIProviderAdapter;
  external: boolean;
  settings: ProviderSettings;
  loaded: LoadedProfile[];
  config: AiConfigValues;
  restrictedCategories: Array<"income">;
}

export interface AiRunSpec {
  admin: SessionAdmin;
  feature: AiFeature;
  language?: string;
  profileIds: string[];
  forMatching?: boolean;
  extraCacheParts?: unknown;
  extraForbidden?: string[];
  build: (ctx: BuildContext) => Promise<ProviderResult>;
}

const HTTP_FOR_REASON: Record<UnavailableReason, number> = {
  KILL_SWITCH: 503,
  PHASE_DISABLED: 503,
  PROVIDER_DISABLED: 503,
  FLAG_OFF: 503,
  NOT_IN_ROLLOUT: 403,
  NO_PERMISSION: 403,
};

function fail(status: number, code: AiFailureCode, message: string, requestId?: string): AiOutcome {
  return { ok: false, status, code, message, requestId };
}

export async function runAiRequest(spec: AiRunSpec): Promise<AiOutcome> {
  const started = Date.now();
  const { admin, feature } = spec;
  const config = await getAiConfig();
  const flags = await getAllFeatureFlags();
  const meta = await getRequestMeta();
  const promptVersion = PROMPT_VERSIONS[feature as AiFeatureKey];

  const base: RequestBase = {
    actorAdminId: admin.id,
    actorRole: admin.role,
    feature,
    provider: config.provider,
    model: config.model,
    promptVersion,
    aiVersion: AI_VERSION,
    appVersion: process.env.APP_VERSION ?? null,
    matchAlgorithmVersion: MATCH_ALGORITHM_VERSION,
    correlationId: meta.correlationId ?? null,
    profileIds: spec.profileIds,
  };
  const latency = () => Date.now() - started;

  // 1. Availability: kill switch, rollout phase, feature flags, permission.
  const avail = evaluateAvailability({ config, flags, admin, feature });
  if (!avail.available) {
    const denied = avail.reason === "NO_PERMISSION" || avail.reason === "NOT_IN_ROLLOUT";
    const requestId = await recordRequest(base, { status: denied ? "DENIED" : "DISABLED", latencyMs: latency(), errorCode: avail.reason });
    if (denied) await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature, reason: avail.reason, requestId });
    return fail(HTTP_FOR_REASON[avail.reason], denied ? "FORBIDDEN" : "DISABLED", UNAVAILABLE_MESSAGE[avail.reason], requestId);
  }

  // 2. Rate limit (per admin × feature) and configured request quotas.
  const rule = rateLimitFor(config, admin.role, feature);
  const limited = await rateLimitPersistent(`ai:${admin.id}:${feature}`, rule.limit, rule.windowSec * 1000);
  if (!limited.allowed) {
    const requestId = await recordRequest(base, { status: "RATE_LIMITED", latencyMs: latency() });
    return fail(429, "RATE_LIMITED", "Too many AI requests for this feature. Please try again later.", requestId);
  }
  const over = quotaExceeded(config, await usageCounts());
  if (over) {
    const requestId = await recordRequest(base, { status: "QUOTA_EXCEEDED", latencyMs: latency(), errorCode: over });
    return fail(429, "QUOTA_EXCEEDED", "The AI usage limit has been reached. Please try again later.", requestId);
  }

  // 3. Authorised data. Anything the admin cannot see is never loaded.
  let loaded: LoadedProfile[] = [];
  try {
    loaded = spec.profileIds.length ? await loadAuthorizedProfiles(admin, spec.profileIds, { matching: spec.forMatching }) : [];
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      const requestId = await recordRequest(base, { status: "DENIED", latencyMs: latency(), errorCode: "PROFILE_ACCESS" });
      await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature, requestId });
      return fail(403, "FORBIDDEN", "You do not have access to one of the selected profiles.", requestId);
    }
    if (err instanceof ApiError && err.status === 400) return fail(400, "INVALID_REQUEST", err.message);
    throw err;
  }

  // 4. Consent (never silently bypassed).
  const consent = await loadConsentDecision(feature, spec.profileIds);
  if (!consent.internalOk) {
    const requestId = await recordRequest(base, { status: "CONSENT_REQUIRED", latencyMs: latency(), consentOutcome: "INTERNAL_WITHDRAWN" });
    return fail(409, "CONSENT_REQUIRED", "AI-assisted processing is not available for a selected profile because the member has withdrawn consent.", requestId);
  }

  // 5. Provider. An external provider is used only when enabled + keyed AND every profile has explicit consent.
  const sel = selectProvider(config);
  if (!sel.provider) {
    const requestId = await recordRequest(base, { status: "DISABLED", latencyMs: latency(), errorCode: "PROVIDER_DISABLED" });
    return fail(503, "DISABLED", UNAVAILABLE_MESSAGE.PROVIDER_DISABLED, requestId);
  }
  const notices: string[] = [];
  let provider = sel.provider;
  let consentOutcome = provider.external ? "EXTERNAL_GRANTED" : "INTERNAL_ONLY";
  if (config.provider === "ANTHROPIC" && sel.reason) notices.push("External AI is not enabled; the built-in analysis was used.");
  if (provider.external && !consent.externalOk) {
    provider = rulesProvider();
    consentOutcome = "EXTERNAL_CONSENT_MISSING";
    notices.push("External AI was not used because the member has not given explicit AI consent; the built-in analysis was used instead.");
  }
  base.provider = provider.kind;
  base.model = provider.model;

  const settings: ProviderSettings = { model: config.model, temperature: config.temperature, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs, retryCount: config.retryCount };
  const restrictedCategories = restrictedCategoriesFor(admin);

  // 6. Cache (only where the storage policy allows a full result).
  const mode = storageModeFor(config, feature);
  const key = cacheKey({
    adminId: admin.id,
    feature,
    profiles: loaded.map((l) => ({ id: l.view.profileId, updatedAt: l.view.updatedAt })),
    matchAlgorithmVersion: MATCH_ALGORITHM_VERSION,
    provider: provider.kind,
    model: provider.model,
    promptVersion,
    aiVersion: AI_VERSION,
    language: spec.language,
    extra: spec.extraCacheParts,
    hidden: loaded[0]?.view.hidden,
  });
  const labels = (): AiLabels => ({
    generatedByAi: true,
    source: "Life Partner Pro database",
    generatedAt: new Date().toISOString(),
    aiVersion: AI_VERSION,
    promptVersion,
    provider: provider.kind,
    model: provider.model,
    matchAlgorithmVersion: MATCH_ALGORITHM_VERSION,
  });
  const forbidden = [...(await loadForbiddenStrings(spec.profileIds)), ...(spec.extraForbidden ?? [])];

  if (cacheableMode(mode)) {
    const cached = await readCachedPayload(key, config.cacheTtlMinutes);
    if (cached && validateLayout(cached)) {
      const safe = applySafetyRules(cached, { forbiddenStrings: forbidden });
      if (!safe.blocked && safe.payload) {
        const requestId = await recordRequest(base, { status: "SUCCESS", latencyMs: latency(), fromCache: true, consentOutcome });
        await auditAi(AUDIT_FOR[feature], admin.id, { feature, requestId, provider: provider.kind, model: provider.model, promptVersion, fromCache: true });
        return { ok: true, payload: safe.payload, labels: labels(), requestId, fromCache: true, notices };
      }
    }
  }

  // 7. Call the provider; on failure fall back to the built-in provider so the core workflow keeps working.
  const ctx: BuildContext = { provider, external: provider.external, settings, loaded, config, restrictedCategories };
  let result: ProviderResult | null = null;
  let status: "SUCCESS" | "FALLBACK" = "SUCCESS";
  let errorCode: string | undefined;
  try {
    // Only a validated result is ever accepted: assign after the schema check.
    const candidate = await spec.build(ctx);
    if (!validateLayout(clampPayload(candidate.payload))) throw new AiProviderError("INVALID_RESPONSE");
    result = candidate;
  } catch (err) {
    const code = err instanceof AiProviderError ? err.code : "UNEXPECTED";
    if (!(err instanceof AiProviderError) && !(err instanceof Error)) throw err;
    if (err instanceof ApiError) throw err;
    errorCode = code;
    await auditAi("AI_PROVIDER_ERROR", admin.id, { feature, provider: provider.kind, model: provider.model, errorCode: code });
    if (provider.external) {
      try {
        provider = rulesProvider();
        base.provider = provider.kind;
        base.model = provider.model;
        const fallbackResult = await spec.build({ ...ctx, provider, external: false });
        if (!validateLayout(clampPayload(fallbackResult.payload))) throw new AiProviderError("INVALID_RESPONSE");
        result = fallbackResult;
        status = "FALLBACK";
        notices.push("AI assistance is temporarily unavailable; the built-in analysis is shown instead.");
      } catch {
        result = null;
      }
    }
    if (!result) {
      const requestId = await recordRequest(base, { status: "FAILED", latencyMs: latency(), errorCode, consentOutcome });
      return fail(503, "UNAVAILABLE", "AI assistance is temporarily unavailable. Deterministic matching and all other features are unaffected.", requestId);
    }
  }

  // 8. Validate → safety filter.
  const payload: AiPayload = clampPayload(result.payload);
  const safe = applySafetyRules(payload, { forbiddenStrings: forbidden });
  if (safe.blocked || !safe.payload) {
    const requestId = await recordRequest(base, { status: "BLOCKED_SAFETY", latencyMs: latency(), errorCode: "SAFETY", consentOutcome });
    await recordSafetyEvents({ requestId, actorAdminId: admin.id, feature, events: safe.events });
    await auditAi("AI_SAFETY_BLOCK", admin.id, { feature, requestId, rules: [...new Set(safe.events.map((e) => e.rule))] });
    return fail(422, "SAFETY_BLOCKED", "The AI output was withheld by the safety filter. Please review the profile data manually.", requestId);
  }

  // 9. Persist per policy, count usage, audit.
  const cost = estimateCost(config, result.usage);
  const requestId = await recordRequest(base, {
    status,
    latencyMs: latency(),
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    estimatedCostUsd: cost.costUsd,
    costIsEstimate: cost.isEstimate,
    consentOutcome,
    errorCode,
  });
  if (safe.events.length) await recordSafetyEvents({ requestId, actorAdminId: admin.id, feature, events: safe.events });
  if (mode !== "DO_NOT_STORE") {
    await storeResult({
      requestId,
      feature,
      profileIds: spec.profileIds,
      structured: payloadToStore(mode, safe.payload),
      expiresAt: expiryFor(config),
      cacheKey: cacheableMode(mode) ? key : null,
      storageMode: mode,
    });
  }
  await auditAi(AUDIT_FOR[feature], admin.id, { feature, requestId, provider: provider.kind, model: provider.model, promptVersion, status, correlationId: meta.correlationId ?? null });
  await logAiAccess(admin.id, feature, spec.profileIds);

  return { ok: true, payload: safe.payload, labels: labels(), requestId, fromCache: false, notices };
}
