import { describe, it, expect } from "vitest";
import { whatsappChatUrl, whatsappDigits } from "./whatsapp-link";

describe("whatsapp click-to-chat links", () => {
  it("turns Pakistani numbers written in any common way into wa.me digits", () => {
    for (const raw of ["0319-8430458", "03198430458", "+92 319 8430458", "00923198430458", "3198430458"]) expect(whatsappDigits(raw), raw).toBe("923198430458");
  });

  it("returns null for a missing or unusable number", () => {
    for (const raw of [null, undefined, "", "   ", "abc", "12"]) expect(whatsappChatUrl(raw), String(raw)).toBeNull();
  });

  it("builds the link with the message encoded", () => {
    expect(whatsappChatUrl("0319-8430458", "Hi, I'd like to know more & ask")).toBe("https://wa.me/923198430458?text=Hi%2C%20I'd%20like%20to%20know%20more%20%26%20ask");
    expect(whatsappChatUrl("0319-8430458")).toBe("https://wa.me/923198430458");
    expect(whatsappChatUrl("0319-8430458", "   ")).toBe("https://wa.me/923198430458");
  });

  it("cannot be steered to another host or path by the number or the message", () => {
    const url = whatsappChatUrl("0319-8430458", "x#y?z=1&to=evil")!;
    expect(new URL(url).host).toBe("wa.me");
    expect(new URL(url).pathname).toBe("/923198430458");
    expect(new URL(url).searchParams.get("text")).toBe("x#y?z=1&to=evil");
    expect(whatsappChatUrl("https://evil.example/923198430458")).toBeNull();
  });

  it("limits the message length", () => {
    const url = whatsappChatUrl("0319-8430458", "a".repeat(5000))!;
    expect(new URL(url).searchParams.get("text")!.length).toBe(1000);
  });
});
