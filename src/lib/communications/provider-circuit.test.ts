import { describe, it, expect } from "vitest";
import { BREAKER_COOLDOWN_MS, circuitOpen, circuitReopensAt } from "@/lib/communications/provider-health";

// STEP 34 §32 — a provider that is DOWN is not hammered; after a cooldown one message probes it.
const t0 = new Date("2026-10-12T10:00:00Z");
const down = (failedAgoMs: number | null) => ({ healthStatus: "DOWN", lastFailureAt: failedAgoMs === null ? null : new Date(t0.getTime() - failedAgoMs) });

describe("circuitOpen", () => {
  it("is open for a DOWN provider that failed within the cooldown", () => {
    expect(circuitOpen(down(1_000), t0)).toBe(true);
    expect(circuitOpen(down(BREAKER_COOLDOWN_MS - 1), t0)).toBe(true);
  });

  it("goes half-open once the cooldown has passed, so one message can probe the provider", () => {
    expect(circuitOpen(down(BREAKER_COOLDOWN_MS), t0)).toBe(false);
    expect(circuitOpen(down(BREAKER_COOLDOWN_MS + 60_000), t0)).toBe(false);
  });

  it.each(["HEALTHY", "DEGRADED", "UNKNOWN"])("never opens for a %s provider (only DOWN opens it)", (healthStatus) => {
    expect(circuitOpen({ healthStatus, lastFailureAt: new Date(t0.getTime() - 1000) }, t0)).toBe(false);
  });

  it("never opens for a provider with no recorded failure, or one that is not tracked", () => {
    expect(circuitOpen(down(null), t0)).toBe(false);
    expect(circuitOpen(null, t0)).toBe(false);
    expect(circuitOpen(undefined, t0)).toBe(false);
  });

  it("reports when the circuit reopens", () => {
    expect(circuitReopensAt({ lastFailureAt: new Date(t0.getTime() - 60_000) })!.getTime()).toBe(t0.getTime() - 60_000 + BREAKER_COOLDOWN_MS);
    expect(circuitReopensAt({ lastFailureAt: null })).toBeNull();
  });

  it("the cooldown is five minutes", () => {
    expect(BREAKER_COOLDOWN_MS).toBe(300_000);
  });
});
