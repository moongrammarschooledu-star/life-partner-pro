import type { AiProviderKind } from "@prisma/client";
import { RulesProvider } from "@/lib/ai/providers/rules";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import type { AIProviderAdapter } from "@/lib/ai/providers/types";

const rules = new RulesProvider();

export function rulesProvider(): AIProviderAdapter {
  return rules;
}

export function externalKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// Chooses the configured provider. An external provider is returned ONLY when
// it is explicitly allowed AND its key is present; otherwise the built-in
// provider is used, so a half-configured system never sends data anywhere.
export function selectProvider(config: { provider: AiProviderKind; externalProviderAllowed: boolean; model: string }): { provider: AIProviderAdapter | null; reason: string | null } {
  switch (config.provider) {
    case "DISABLED":
      return { provider: null, reason: "PROVIDER_DISABLED" };
    case "RULES":
      return { provider: rules, reason: null };
    case "ANTHROPIC":
      if (!config.externalProviderAllowed) return { provider: rules, reason: "EXTERNAL_NOT_ALLOWED" };
      if (!externalKeyPresent()) return { provider: rules, reason: "EXTERNAL_KEY_MISSING" };
      return { provider: new AnthropicProvider(config.model), reason: null };
    default:
      return { provider: rules, reason: "UNKNOWN_PROVIDER" };
  }
}
