import { describe, it, expect } from "vitest";
import { comparisonShareMessage, firstName } from "./proposal-share-message";
import { whatsappChatUrl } from "./whatsapp-link";

describe("proposal share message", () => {
  it("greets the person by first name and states the match", () => {
    const text = comparisonShareMessage({ fullName: "Usman Ali Khan", matchPercent: 89.6 });
    expect(text).toContain("Assalam-o-Alaikum Usman,");
    expect(text).toContain("(90% match)");
    expect(text).not.toContain("Khan");
  });

  it("leaves out the match when there is none and copes with a missing name", () => {
    const text = comparisonShareMessage({ fullName: "  ", matchPercent: null });
    expect(text.startsWith("Assalam-o-Alaikum,")).toBe(true);
    expect(text).not.toContain("match)");
    expect(firstName(undefined)).toBe("");
  });

  it("makes a usable WhatsApp link", () => {
    const url = whatsappChatUrl("0319-8430458", comparisonShareMessage({ fullName: "Aeeman Nasir", matchPercent: 90 }));
    expect(url?.startsWith("https://wa.me/923198430458?text=")).toBe(true);
  });
});
