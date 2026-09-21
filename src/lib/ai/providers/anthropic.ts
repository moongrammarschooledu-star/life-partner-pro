import { z } from "zod";
import { promptFor } from "@/lib/ai/prompts";
import { buildProfileSummary, STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import { buildMatchExplanation } from "@/lib/ai/analysis/match-review";
import { buildComparison } from "@/lib/ai/analysis/comparison";
import { buildCommunicationDraft } from "@/lib/ai/analysis/drafts";
import { detectFindings } from "@/lib/ai/analysis/quality";
import { checkText } from "@/lib/ai/safety";
import type { AiPayload } from "@/lib/ai/types";
import type { AiFeatureKey } from "@/lib/ai/versions";
import {
  AiProviderError,
  type AIProviderAdapter,
  type CompareInput,
  type MatchInput,
  type ProfileInput,
  type ProviderResult,
  type ProviderSettings,
  type ProviderUsage,
  type UsageEstimate,
} from "@/lib/ai/providers/types";

// External LLM adapter (Anthropic Messages API). It is OFF unless ALL hold:
//   • ANTHROPIC_API_KEY is set in the environment (never in the database),
//   • AiConfig.externalProviderAllowed is true and provider = ANTHROPIC,
//   • the profile(s) have EXPLICIT AI consent (enforced by the pipeline).
// It only ever receives the minimised, pseudonymous ExternalProfile shape plus
// the deterministic engine's category statuses. Its output is treated as
// untrusted: parsed, schema-validated, merged into the rules-built payload
// (which keeps the deterministic evidence/scores), then passed through the
// safety filter by the pipeline.

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const narrativeSchema = z.object({
  summary: z.string().max(2000),
  alignedAreas: z.array(z.string().max(300)).max(20).default([]),
  potentialConflicts: z.array(z.string().max(300)).max(20).default([]),
  missingInformation: z.array(z.string().max(300)).max(20).default([]),
  verificationQuestions: z.array(z.string().max(300)).max(20).default([]),
  suggestedNextStep: z.string().max(300).nullable().default(null),
  limitations: z.array(z.string().max(300)).max(10).default([]),
});
export type Narrative = z.infer<typeof narrativeSchema>;

export interface AnthropicOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  sleep?: (ms: number) => Promise<void>;
}

const union = (a: string[], b: string[], max = 40) => [...new Set([...a, ...b])].slice(0, max);

export function parseNarrative(raw: string): Narrative {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiProviderError("INVALID_RESPONSE", true);
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiProviderError("INVALID_RESPONSE", true);
  }
  const parsed = narrativeSchema.safeParse(json);
  if (!parsed.success) throw new AiProviderError("INVALID_RESPONSE", true);
  return parsed.data;
}

export function mergeNarrative(base: AiPayload, n: Narrative): AiPayload {
  return {
    ...base,
    summary: n.summary,
    alignedAreas: union(base.alignedAreas, n.alignedAreas),
    potentialConflicts: union(base.potentialConflicts, n.potentialConflicts),
    missingInformation: union(base.missingInformation, n.missingInformation),
    verificationQuestions: union(base.verificationQuestions, n.verificationQuestions, 30),
    suggestedNextStep: n.suggestedNextStep ?? base.suggestedNextStep,
    limitations: union(base.limitations, [...STANDARD_LIMITATIONS, ...n.limitations], 20),
    data: { ...(base.data ?? {}), narrativeProvider: "ANTHROPIC" },
  };
}

export class AnthropicProvider implements AIProviderAdapter {
  readonly kind = "ANTHROPIC" as const;
  readonly external = true;

  constructor(public readonly model: string, private readonly opts: AnthropicOptions = {}) {}

  private key(): string {
    const k = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!k || !k.trim()) throw new AiProviderError("NOT_CONFIGURED");
    return k.trim();
  }

  // One request with timeout; retries only on retryable failures.
  private async complete(system: string, user: string, s: ProviderSettings): Promise<{ text: string; usage: ProviderUsage }> {
    const key = this.key();
    const doFetch = this.opts.fetchImpl ?? fetch;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const attempts = 1 + Math.max(0, Math.min(3, s.retryCount));
    let last: AiProviderError = new AiProviderError("UNAVAILABLE", true);

    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, s.timeoutMs));
      try {
        const res = await doFetch(API_URL, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": API_VERSION },
          body: JSON.stringify({
            model: s.model || this.model,
            max_tokens: s.maxOutputTokens,
            temperature: s.temperature,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!res.ok) {
          const status = res.status;
          if (status === 401 || status === 403) throw new AiProviderError("AUTH");
          if (status === 402) throw new AiProviderError("QUOTA");
          if (status === 413) throw new AiProviderError("TOO_LARGE");
          if (status === 429) throw new AiProviderError("RATE_LIMIT", true);
          if (status >= 500) throw new AiProviderError("UNAVAILABLE", true);
          throw new AiProviderError("INVALID_RESPONSE");
        }
        const body = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
        const text = body.content?.find((b) => b.type === "text")?.text;
        if (!text) throw new AiProviderError("INVALID_RESPONSE", true);
        return { text, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
      } catch (err) {
        const e =
          err instanceof AiProviderError
            ? err
            : (err as { name?: string })?.name === "AbortError"
              ? new AiProviderError("TIMEOUT", true)
              : new AiProviderError("UNAVAILABLE", true);
        last = e;
        if (!e.retryable || i === attempts - 1) throw e;
        await sleep(300 * (i + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw last;
  }

  private async narrative(feature: AiFeatureKey, userPayload: unknown, s: ProviderSettings): Promise<{ n: Narrative; usage: ProviderUsage }> {
    const prompt = promptFor(feature);
    const { text, usage } = await this.complete(prompt.system, JSON.stringify(userPayload), s);
    return { n: parseNarrative(text), usage };
  }

  async generateText(prompt: string, s: ProviderSettings): Promise<string> {
    const { text } = await this.complete("You are a concise assistant. Never output contact details or guarantees.", prompt, s);
    return text;
  }

  async analyzeProfile(input: ProfileInput, s: ProviderSettings): Promise<ProviderResult> {
    const findings = detectFindings(input.view).map((f) => ({ label: f.label, area: f.area, message: f.message }));
    const { n, usage } = await this.narrative("PROFILE_SUMMARY", { profile: input.external, deterministicFindings: findings }, s);
    return { payload: mergeNarrative(buildProfileSummary(input.view), n), usage };
  }

  async explainMatch(input: MatchInput, s: ProviderSettings): Promise<ProviderResult> {
    const categories = input.mutual.categories.map((c) => ({ category: c.label, status: c.combined, [`${input.externalA.ref} -> ${input.externalB.ref}`]: c.aToB, [`${input.externalB.ref} -> ${input.externalA.ref}`]: c.bToA, restricted: c.restricted }));
    const { n, usage } = await this.narrative("MATCH_EXPLANATION", { profiles: [input.externalA, input.externalB], categoryStatuses: categories }, s);
    return { payload: mergeNarrative(buildMatchExplanation(input.a, input.b, input.mutual), n), usage };
  }

  async compareProfiles(input: CompareInput, s: ProviderSettings): Promise<ProviderResult> {
    const { n, usage } = await this.narrative("COMPARE", { profiles: input.externals }, s);
    return { payload: mergeNarrative(buildComparison(input.views, input.pairs), n), usage };
  }

  // Drafts never go to an external model — they are template-built in-process.
  async generateCommunication(input: Parameters<AIProviderAdapter["generateCommunication"]>[0]): Promise<ProviderResult> {
    return { payload: buildCommunicationDraft(input) };
  }

  async moderateContent(text: string, ctx?: Parameters<AIProviderAdapter["moderateContent"]>[1]) {
    return checkText(text, ctx);
  }

  estimateUsage(inputChars: number, s: ProviderSettings, price?: { inputPerMTokUsd?: number | null; outputPerMTokUsd?: number | null }): UsageEstimate {
    const inputTokens = Math.ceil(inputChars / 4) + 500; // rough: ~4 chars/token plus the system prompt
    const outputTokens = Math.ceil(s.maxOutputTokens / 2);
    const estimatedCostUsd =
      price?.inputPerMTokUsd != null && price?.outputPerMTokUsd != null
        ? (inputTokens * price.inputPerMTokUsd + outputTokens * price.outputPerMTokUsd) / 1_000_000
        : null;
    return { inputTokens, outputTokens, estimatedCostUsd };
  }
}
