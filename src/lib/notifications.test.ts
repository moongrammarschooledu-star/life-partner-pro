import { describe, it, expect, vi, beforeEach } from "vitest";

const chainMock = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/communications/providers/registry", () => ({
  resolveProviderChain: chainMock,
  eligibleFailoverChain: async (c: unknown[]) => c,
}));
vi.mock("@/lib/communications/provider-health", () => ({ recordProviderOutcome: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/prisma", () => ({ prisma: { communicationLog: { create } } }));

import { notificationService } from "@/lib/notifications";

function adapter(result: { ok: boolean; failureClass?: "RETRYABLE" | "PERMANENT"; error?: string; providerMessageId?: string }) {
  return {
    validateRecipient: (to: string) => ({ valid: true, normalized: to }),
    sendOTP: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => {
  chainMock.mockReset();
  create.mockReset();
});

describe("notificationService (carries admin login and verification codes)", () => {
  it("delivers through the provider registry with the OTP purpose, subject and body", async () => {
    const a = adapter({ ok: true, providerMessageId: "m1" });
    chainMock.mockResolvedValue([{ adapter: a, providerKey: "builtin-email_smtp", row: null, sandboxed: false, failover: false }]);
    await notificationService.send({ channel: "EMAIL", to: "admin@example.com", subject: "Your code", body: "Your code is 123456." });
    expect(a.sendOTP).toHaveBeenCalledWith({ to: "admin@example.com", body: "Your code is 123456.", subject: "Your code", purpose: "OTP" });
  });

  it("propagates a delivery failure so the caller never claims a code was sent", async () => {
    chainMock.mockResolvedValue([{ adapter: adapter({ ok: false, failureClass: "RETRYABLE", error: "SMTP down" }), providerKey: "x", row: null, sandboxed: false, failover: false }]);
    await expect(notificationService.send({ channel: "EMAIL", to: "a@b.co", body: "x" })).rejects.toThrow("SMTP down");
  });

  it("fails over to the next eligible provider on a retryable failure but not on a permanent one", async () => {
    const bad = adapter({ ok: false, failureClass: "RETRYABLE", error: "timeout" });
    const good = adapter({ ok: true, providerMessageId: "m2" });
    chainMock.mockResolvedValue([
      { adapter: bad, providerKey: "a", row: null, sandboxed: false, failover: false },
      { adapter: good, providerKey: "b", row: null, sandboxed: false, failover: true },
    ]);
    await notificationService.send({ channel: "SMS", to: "+923001234567", body: "x" });
    expect(good.sendOTP).toHaveBeenCalledTimes(1);

    const permanent = adapter({ ok: false, failureClass: "PERMANENT", error: "REJECTED" });
    const never = adapter({ ok: true });
    chainMock.mockResolvedValue([
      { adapter: permanent, providerKey: "a", row: null, sandboxed: false, failover: false },
      { adapter: never, providerKey: "b", row: null, sandboxed: false, failover: true },
    ]);
    await expect(notificationService.send({ channel: "SMS", to: "+923001234567", body: "x" })).rejects.toThrow("REJECTED");
    expect(never.sendOTP).not.toHaveBeenCalled();
  });

  it("writes a status row WITHOUT the code when the profile is known", async () => {
    chainMock.mockResolvedValue([{ adapter: adapter({ ok: true, providerMessageId: "m3" }), providerKey: "p", row: null, sandboxed: false, failover: false }]);
    create.mockResolvedValue({});
    await notificationService.send({ channel: "SMS", to: "+923001234567", body: "Your code is 654321", profileId: "prof1" });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.messageBody).toBeNull();
    expect(JSON.stringify(data)).not.toContain("654321");
    expect(data.purpose).toBe("OTP");
    expect(data.recipientReference).not.toContain("3001234567");
  });

  it("rejects an invalid destination before contacting any provider", async () => {
    const a = { validateRecipient: () => ({ valid: false, reason: "bad" }), sendOTP: vi.fn() };
    chainMock.mockResolvedValue([{ adapter: a, providerKey: "p", row: null, sandboxed: false, failover: false }]);
    await expect(notificationService.send({ channel: "EMAIL", to: "nope", body: "x" })).rejects.toThrow(/Invalid/);
    expect(a.sendOTP).not.toHaveBeenCalled();
  });
});
