import { buildProfileSummary } from "@/lib/ai/analysis/summary";
import { buildMatchExplanation } from "@/lib/ai/analysis/match-review";
import { buildComparison } from "@/lib/ai/analysis/comparison";
import { buildCommunicationDraft } from "@/lib/ai/analysis/drafts";
import { checkText } from "@/lib/ai/safety";
import type { AIProviderAdapter, ProviderResult, UsageEstimate } from "@/lib/ai/providers/types";

// The built-in provider. Deterministic, template- and rule-driven, runs
// in-process: no network call, no data leaves the system, no per-request cost.
// It is a real, working provider — not a stub — but it does not "understand"
// free text the way a language model would; it restates and organises the
// platform's own data and the deterministic matcher's output.
export class RulesProvider implements AIProviderAdapter {
  readonly kind = "RULES" as const;
  readonly external = false;
  readonly model = "lpp-rules-v1";

  async generateText(prompt: string): Promise<string> {
    // Not a language model: echo nothing generative. Used only as a typed seam.
    return prompt.slice(0, 0);
  }

  async analyzeProfile(input: { view: Parameters<typeof buildProfileSummary>[0] }): Promise<ProviderResult> {
    return { payload: buildProfileSummary(input.view) };
  }

  async explainMatch(input: Parameters<AIProviderAdapter["explainMatch"]>[0]): Promise<ProviderResult> {
    return { payload: buildMatchExplanation(input.a, input.b, input.mutual) };
  }

  async compareProfiles(input: Parameters<AIProviderAdapter["compareProfiles"]>[0]): Promise<ProviderResult> {
    return { payload: buildComparison(input.views, input.pairs) };
  }

  async generateCommunication(input: Parameters<AIProviderAdapter["generateCommunication"]>[0]): Promise<ProviderResult> {
    return { payload: buildCommunicationDraft(input) };
  }

  async moderateContent(text: string, ctx?: Parameters<AIProviderAdapter["moderateContent"]>[1]) {
    return checkText(text, ctx);
  }

  estimateUsage(): UsageEstimate {
    // No tokens, no cost — stated as such rather than invented.
    return { inputTokens: 0, outputTokens: 0, estimatedCostUsd: null };
  }
}
