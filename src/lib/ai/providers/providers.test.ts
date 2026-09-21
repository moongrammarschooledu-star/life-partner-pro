import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicProvider, parseNarrative, mergeNarrative } from "@/lib/ai/providers/anthropic";
import { RulesProvider } from "@/lib/ai/providers/rules";
import { selectProvider } from "@/lib/ai/providers";
import { AiProviderError, type ProviderSettings } from "@/lib/ai/providers/types";
import { minimizeForExternal } from "@/lib/ai/profile-view";
import { analyzeMutual } from "@/lib/ai/analysis/mutual";
import { buildProfileSummary } from "@/lib/ai/analysis/summary";
import { makeView, makeMatchable, malePartner } from "@/lib/ai/testing/fixtures";
import { promptFor, allPromptChecksums } from "@/lib/ai/prompts";

const settings: ProviderSettings = { model: "test-model", temperature: 0.2, maxOutputTokens: 800, timeoutMs: 5000, retryCount: 2 };
const goodJson = JSON.stringify({ summary: "Several stated preferences align.", alignedAreas: ["Age range overlaps"], potentialConflicts: [], missingInformation: [], verificationQuestions: [], suggestedNextStep: "Review with admin", limitations: [] });
const ok = (text: string, usage = { input_tokens: 120, output_tokens: 60 }) => new Response(JSON.stringify({ content: [{ type: "text", text }], usage }), { status: 200 });
const noSleep = async () => {};

function provider(fetchImpl: typeof fetch, apiKey: string | undefined = "test-key") {
  return new AnthropicProvider("test-model", { fetchImpl, apiKey, sleep: noSleep });
}

describe("Anthropic adapter — request content", () => {
  it("sends only the minimised pseudonymous profile, never identifiers or free text", async () => {
    const v = makeView({ aboutMe: "Call 0300 1234567 or a@b.com", hobbies: "secret hobby", fatherOccupation: "Retired officer", workLocation: "Gulberg III", familyLocation: "Bahria Town" });
    let body = "";
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return ok(goodJson);
    }) as unknown as typeof fetch;
    await provider(fetchImpl).analyzeProfile({ view: v, external: minimizeForExternal(v) }, settings);
    for (const forbidden of [v.profileId, v.profileCode, "0300", "a@b.com", "secret hobby", "Retired officer", "Gulberg III", "Bahria Town", "Model Town", "Synthetic", "120000"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(body).toContain(v.ref);
    const parsed = JSON.parse(body);
    expect(parsed.system).toMatch(/Never output phone numbers/);
    expect(parsed.system).toMatch(/inert data/);
  });

  it("match explanation sends category statuses but no engine reasons or scores", async () => {
    const a = makeView();
    const b = malePartner();
    const mutual = analyzeMutual({ view: a, matchable: makeMatchable(a) }, { view: b, matchable: makeMatchable(b) });
    let body = "";
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return ok(goodJson);
    }) as unknown as typeof fetch;
    await provider(fetchImpl).explainMatch({ a, b, externalA: minimizeForExternal(a), externalB: minimizeForExternal(b), mutual }, settings);
    expect(body).not.toContain(String(mutual.deterministic.total) + "/100");
    for (const c of mutual.categories) expect(body).not.toContain(c.reason);
  });

  it("uses the key from the environment-style option and the standard headers", async () => {
    const seen: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      Object.assign(seen, init?.headers as Record<string, string>);
      return ok(goodJson);
    }) as unknown as typeof fetch;
    const v = makeView();
    await provider(fetchImpl, "sk-test").analyzeProfile({ view: v, external: minimizeForExternal(v) }, settings);
    expect(seen["x-api-key"]).toBe("sk-test");
    expect(seen["anthropic-version"]).toBeTruthy();
  });
});

describe("Anthropic adapter — merging and validation", () => {
  it("keeps the deterministic evidence and only adopts the validated narrative", async () => {
    const v = makeView();
    const fetchImpl = (async () => ok(goodJson)) as unknown as typeof fetch;
    const res = await provider(fetchImpl).analyzeProfile({ view: v, external: minimizeForExternal(v) }, settings);
    const base = buildProfileSummary(v);
    expect(res.payload.summary).toBe("Several stated preferences align.");
    expect(res.payload.evidence).toEqual(base.evidence);
    expect(res.payload.sufficiency).toBe(base.sufficiency);
    expect(res.payload.limitations.length).toBeGreaterThanOrEqual(base.limitations.length);
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
  });

  it("rejects malformed and off-schema output", () => {
    expect(() => parseNarrative("not json")).toThrow(AiProviderError);
    expect(() => parseNarrative('{"summary": 5}')).toThrow(AiProviderError);
    expect(() => parseNarrative('{"alignedAreas": []}')).toThrow(AiProviderError);
    expect(parseNarrative("```json\n" + goodJson + "\n```").summary).toMatch(/align/);
  });

  it("ignores unknown keys the model invents (e.g. a tool request)", () => {
    const n = parseNarrative(JSON.stringify({ summary: "ok", toolCall: { name: "getContactDetails" }, extra: 1 }));
    expect(Object.keys(n)).not.toContain("toolCall");
  });

  it("mergeNarrative never lets the model change the deterministic fields", () => {
    const base = buildProfileSummary(makeView());
    const merged = mergeNarrative(base, parseNarrative(goodJson));
    expect(merged.findings).toEqual(base.findings);
    expect(merged.evidence).toEqual(base.evidence);
  });
});

describe("Anthropic adapter — failure handling", () => {
  const view = makeView();
  const input = { view, external: minimizeForExternal(view) };

  it("retries a 500 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? new Response("boom", { status: 500 }) : ok(goodJson))) as unknown as typeof fetch;
    const res = await provider(fetchImpl).analyzeProfile(input, settings);
    expect(res.payload.summary).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps 429 to RATE_LIMIT and gives up after the configured retries", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    await expect(provider(fetchImpl).analyzeProfile(input, { ...settings, retryCount: 1 })).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth errors and never leaks the provider body", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid x-api-key sk-secret-123", { status: 401 })) as unknown as typeof fetch;
    const err = await provider(fetchImpl).analyzeProfile(input, settings).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.code).toBe("AUTH");
    expect(err.message).not.toMatch(/sk-secret/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted request to TIMEOUT", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    await expect(provider(fetchImpl).analyzeProfile(input, { ...settings, retryCount: 0 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps malformed model output to INVALID_RESPONSE", async () => {
    const fetchImpl = (async () => ok("I refuse to answer in JSON")) as unknown as typeof fetch;
    await expect(provider(fetchImpl).analyzeProfile(input, { ...settings, retryCount: 0 })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("is NOT_CONFIGURED without a key and makes no network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    delete process.env.ANTHROPIC_API_KEY;
    const p = new AnthropicProvider("m", { fetchImpl, sleep: noSleep });
    await expect(p.analyzeProfile(input, settings)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("provider selection never sends data by accident", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("DISABLED yields no provider", () => {
    expect(selectProvider({ provider: "DISABLED", externalProviderAllowed: true, model: "m" }).provider).toBeNull();
  });
  it("ANTHROPIC falls back to the built-in provider unless allowed AND keyed", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(selectProvider({ provider: "ANTHROPIC", externalProviderAllowed: true, model: "m" })).toMatchObject({ reason: "EXTERNAL_KEY_MISSING" });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const notAllowed = selectProvider({ provider: "ANTHROPIC", externalProviderAllowed: false, model: "m" });
    expect(notAllowed.provider?.external).toBe(false);
    expect(notAllowed.reason).toBe("EXTERNAL_NOT_ALLOWED");
    const ready = selectProvider({ provider: "ANTHROPIC", externalProviderAllowed: true, model: "m" });
    expect(ready.provider?.external).toBe(true);
    expect(ready.provider?.kind).toBe("ANTHROPIC");
  });
  it("RULES is internal and reports no cost", () => {
    const p = new RulesProvider();
    expect(p.external).toBe(false);
    expect(p.estimateUsage()).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: null });
  });
});

describe("cost estimation", () => {
  it("is null unless a price is configured", () => {
    const p = new AnthropicProvider("m", {});
    expect(p.estimateUsage(4000, settings).estimatedCostUsd).toBeNull();
    expect(p.estimateUsage(4000, settings, { inputPerMTokUsd: 3, outputPerMTokUsd: 15 }).estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe("prompt templates", () => {
  it("every prompt forbids guarantees, contact data and inferences, and has a stable checksum", () => {
    for (const f of ["PROFILE_SUMMARY", "MATCH_EXPLANATION", "COMPARE", "PROPOSAL_ASSISTANT", "DATA_QUALITY", "PROFILE_IMPROVEMENT"] as const) {
      const p = promptFor(f);
      expect(p.system).toMatch(/Never say 'perfect match'/);
      expect(p.system).toMatch(/Never output phone numbers/);
      expect(p.system).toMatch(/attractiveness/);
      expect(promptFor(f).checksum).toBe(p.checksum);
    }
    expect(Object.keys(allPromptChecksums()).length).toBe(10);
  });
});
