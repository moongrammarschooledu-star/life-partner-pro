import type { AiProviderKind } from "@prisma/client";
import type { AiPayload, AiLanguage, CommunicationKind } from "@/lib/ai/types";
import type { AiProfileView, ExternalProfile } from "@/lib/ai/profile-view";
import type { MutualAnalysis } from "@/lib/ai/analysis/mutual";
import type { SafetyContext, TextCheck } from "@/lib/ai/safety";

// Spec §21 — the application is never hard-wired to one AI provider. Every
// provider implements this interface. The rules provider runs entirely
// in-process; an external provider only ever receives the minimised,
// pseudonymous ExternalProfile shape (never an AiProfileView).

export type ProviderErrorCode = "TIMEOUT" | "UNAVAILABLE" | "RATE_LIMIT" | "QUOTA" | "AUTH" | "INVALID_RESPONSE" | "TOO_LARGE" | "NOT_CONFIGURED";

// Raw provider messages are never shown to users (spec §40): only this code is.
export class AiProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, public readonly retryable: boolean = false) {
    super(`AI provider error: ${code}`);
    this.name = "AiProviderError";
  }
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderResult {
  payload: AiPayload;
  usage?: ProviderUsage;
}

export interface UsageEstimate {
  inputTokens: number;
  outputTokens: number;
  // null when the provider reports no usable pricing — never invented.
  estimatedCostUsd: number | null;
}

export interface ProviderSettings {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: number;
}

export interface ProfileInput {
  view: AiProfileView;
  external: ExternalProfile;
}

export interface MatchInput {
  a: AiProfileView;
  b: AiProfileView;
  externalA: ExternalProfile;
  externalB: ExternalProfile;
  mutual: MutualAnalysis;
}

export interface CompareInput {
  views: AiProfileView[];
  externals: ExternalProfile[];
  pairs: Array<{ a: string; b: string; analysis: MutualAnalysis }>;
}

export interface AIProviderAdapter {
  readonly kind: AiProviderKind;
  // true ⇒ data leaves the system; the pipeline then requires explicit
  // per-profile AI consent and sends only minimised, pseudonymous input.
  readonly external: boolean;
  readonly model: string;

  generateText(prompt: string, settings: ProviderSettings): Promise<string>;
  analyzeProfile(input: ProfileInput, settings: ProviderSettings): Promise<ProviderResult>;
  explainMatch(input: MatchInput, settings: ProviderSettings): Promise<ProviderResult>;
  compareProfiles(input: CompareInput, settings: ProviderSettings): Promise<ProviderResult>;
  generateCommunication(input: { kind: CommunicationKind; language: AiLanguage; recipientCode: string }, settings: ProviderSettings): Promise<ProviderResult>;
  moderateContent(text: string, ctx?: SafetyContext): Promise<TextCheck>;
  estimateUsage(inputChars: number, settings: ProviderSettings, price?: { inputPerMTokUsd?: number | null; outputPerMTokUsd?: number | null }): UsageEstimate;
}
