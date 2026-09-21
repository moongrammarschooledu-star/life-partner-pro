import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/providers/email-provider", () => ({ emailProvider: { send } }));

import { notificationService } from "@/lib/notifications";

beforeEach(() => {
  send.mockReset();
});

describe("notificationService (carries admin login and verification codes)", () => {
  it("delivers EMAIL through the real e-mail provider, with subject and body", async () => {
    send.mockResolvedValue({ providerMessageId: "x" });
    await notificationService.send({ channel: "EMAIL", to: "admin@example.com", subject: "Your code", body: "Your code is 123456." });
    expect(send).toHaveBeenCalledWith("admin@example.com", "Your code is 123456.", "Your code");
  });

  it("propagates a delivery failure so the caller never claims a code was sent", async () => {
    send.mockRejectedValue(new Error("SMTP down"));
    await expect(notificationService.send({ channel: "EMAIL", to: "a@b.co", body: "x" })).rejects.toThrow("SMTP down");
  });

  it("does not send SMS or WhatsApp through the e-mail provider", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await notificationService.send({ channel: "SMS", to: "+920000000000", body: "x" });
    await notificationService.send({ channel: "WHATSAPP", to: "+920000000000", body: "x" });
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
