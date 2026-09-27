import { MockVerificationProvider } from "./mock-provider";
import type { IdentityVerificationProvider } from "./types";

const PROVIDERS: Record<string, IdentityVerificationProvider> = {
  mock: MockVerificationProvider,
};

// Server-only — never imported by client code. Reads config on every call
// (cheap env lookups) rather than caching, matching getActiveProvider()'s
// own pattern in src/lib/finance/providers/registry.ts.
export function getVerificationProvider(): IdentityVerificationProvider {
  const name = process.env.IDENTITY_VERIFICATION_PROVIDER ?? "mock";
  return PROVIDERS[name] ?? MockVerificationProvider;
}

export function isIdentityVerificationEnabled(): boolean {
  return process.env.IDENTITY_VERIFICATION_ENABLED === "true";
}

export * from "./types";
