import { createHash } from "crypto";
import type { AiStorageMode } from "@prisma/client";
import { aiLayoutSchema, type AiPayload } from "@/lib/ai/types";
import type { AiConfigValues } from "@/lib/ai/config";

// Spec §26/§29/§67 — what an AI result may leave behind, and for how long.
//   DO_NOT_STORE    nothing is kept
//   SUMMARY_ONLY    headline + counts only (default) — no evidence, no lists
//   FULL_RESULT     the structured result, minus HIGHLY_SENSITIVE lines
//   LIMITED_PERIOD  as FULL_RESULT, expiring after the retention window
// Every stored row gets an expiry (AiConfig.retentionDays) and is purged by the
// retention job and by privacy deletion/anonymisation — there is no
// "keep forever" mode, and no fixed legal retention period is claimed.

// Clamp to the layout schema's limits so a long result can never fail validation.
// Provider output is untrusted, so anything not the expected type is passed
// through unchanged (validateLayout then rejects it) instead of throwing here.
const cut = (s: string, n: number) => (typeof s === "string" && s.length > n ? s.slice(0, n) : s);
const cutAll = (a: unknown, items: number, len: number): string[] => (Array.isArray(a) ? a.slice(0, items).map((s) => cut(s as string, len)) : (a as string[]));

export function clampPayload(p: AiPayload): AiPayload {
  return {
    ...p,
    summary: cut(p.summary, 2000),
    evidence: Array.isArray(p.evidence) ? p.evidence.slice(0, 60).map((e) => ({ ...e, label: cut(e?.label, 80), value: cut(e?.value, 300) })) : p.evidence,
    alignedAreas: cutAll(p.alignedAreas, 40, 300),
    potentialConflicts: cutAll(p.potentialConflicts, 40, 300),
    missingInformation: cutAll(p.missingInformation, 40, 300),
    verificationQuestions: cutAll(p.verificationQuestions, 30, 300),
    suggestedNextStep: typeof p.suggestedNextStep === "string" ? cut(p.suggestedNextStep, 300) : (p.suggestedNextStep ?? null),
    limitations: cutAll(p.limitations, 20, 300),
  };
}

export function validateLayout(p: AiPayload): boolean {
  return aiLayoutSchema.safeParse({
    summary: p.summary,
    evidence: p.evidence,
    alignedAreas: p.alignedAreas,
    potentialConflicts: p.potentialConflicts,
    missingInformation: p.missingInformation,
    verificationQuestions: p.verificationQuestions,
    suggestedNextStep: p.suggestedNextStep,
    limitations: p.limitations,
  }).success;
}

const SENSITIVE_LABEL = /income|salary|earning/i;

// HIGHLY_SENSITIVE data is never stored in AI history (spec §19).
export function redactForStorage(p: AiPayload): AiPayload {
  const data = p.data ? JSON.parse(JSON.stringify(p.data)) : undefined;
  if (data?.columns && Array.isArray(data.columns)) data.columns = data.columns.filter((c: { field?: string }) => !SENSITIVE_LABEL.test(c.field ?? ""));
  if (data?.categories && Array.isArray(data.categories)) data.categories = data.categories.filter((c: { category?: string }) => c.category !== "income");
  return { ...p, evidence: p.evidence.filter((e) => !SENSITIVE_LABEL.test(e.label)), data };
}

export function summaryOnly(p: AiPayload): Record<string, unknown> {
  return {
    summary: p.summary,
    sufficiency: p.sufficiency,
    counts: { evidence: p.evidence.length, aligned: p.alignedAreas.length, conflicts: p.potentialConflicts.length, missing: p.missingInformation.length },
  };
}

export function payloadToStore(mode: AiStorageMode, p: AiPayload): Record<string, unknown> | null {
  if (mode === "DO_NOT_STORE") return null;
  if (mode === "SUMMARY_ONLY") return summaryOnly(p);
  return redactForStorage(p) as unknown as Record<string, unknown>;
}

export function cacheableMode(mode: AiStorageMode): boolean {
  return mode === "FULL_RESULT" || mode === "LIMITED_PERIOD";
}

export function expiryFor(config: Pick<AiConfigValues, "retentionDays">, now: Date = new Date()): Date {
  return new Date(now.getTime() + Math.max(1, config.retentionDays) * 86_400_000);
}

// Cache key (spec §26): scoped to the requesting admin, and to the exact
// profile versions, algorithm, model, prompt and language. Any change to the
// underlying profile (updatedAt), matcher version or prompt yields a new key,
// which is how stale results are invalidated.
export function cacheKey(parts: {
  adminId: string;
  feature: string;
  profiles: Array<{ id: string; updatedAt: string }>;
  matchAlgorithmVersion: string;
  provider: string;
  model: string;
  promptVersion: string;
  aiVersion: string;
  language?: string;
  extra?: unknown;
  // Hidden-field state changes what the admin may see, so it is part of the key.
  hidden?: { income: boolean; familyDetails: boolean };
}): string {
  const canonical = JSON.stringify({ ...parts, profiles: [...parts.profiles].sort((a, b) => a.id.localeCompare(b.id)) });
  return createHash("sha256").update(canonical).digest("hex");
}
