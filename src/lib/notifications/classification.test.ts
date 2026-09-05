import { describe, it, expect } from "vitest";
import { classify, shouldAttemptExternalChannel } from "@/lib/notifications/classification";

describe("classify", () => {
  it("marks account/verification/matching/contact/admin types essential", () => {
    expect(classify("ACCOUNT_REGISTERED").essential).toBe(true);
    expect(classify("VERIFICATION_APPROVED").essential).toBe(true);
    expect(classify("MATCH_IDENTIFIED").essential).toBe(true);
    expect(classify("CONTACT_PERMISSION_APPROVED").essential).toBe(true);
    expect(classify("ADMIN_SUSPICIOUS_ACTIVITY").essential).toBe(true);
  });

  it("marks proposal/meeting/followup types non-essential with a preference category", () => {
    expect(classify("PROPOSAL_RECEIVED")).toEqual({ essential: false, preferenceCategory: "PROPOSAL" });
    expect(classify("MEETING_SCHEDULED")).toEqual({ essential: false, preferenceCategory: "MEETING" });
    expect(classify("FOLLOWUP_REMINDER")).toEqual({ essential: false, preferenceCategory: "FOLLOWUP" });
  });
});

describe("shouldAttemptExternalChannel", () => {
  it("blocks everything when the channel is disabled platform-wide, even essential types", () => {
    expect(
      shouldAttemptExternalChannel({ type: "VERIFICATION_APPROVED", channelEnabledInSettings: false, preferenceValue: null, consentStatus: null })
    ).toBe(false);
  });

  it("essential types bypass preference and consent once the channel is enabled", () => {
    expect(
      shouldAttemptExternalChannel({
        type: "VERIFICATION_APPROVED",
        channelEnabledInSettings: true,
        preferenceValue: false,
        consentStatus: "REVOKED",
      })
    ).toBe(true);
  });

  it("non-essential type is blocked when the category preference is off", () => {
    expect(
      shouldAttemptExternalChannel({ type: "PROPOSAL_RECEIVED", channelEnabledInSettings: true, preferenceValue: false, consentStatus: "GRANTED" })
    ).toBe(false);
  });

  it("non-essential type uses the schema default (true) when no preference row exists yet", () => {
    expect(
      shouldAttemptExternalChannel({ type: "MEETING_SCHEDULED", channelEnabledInSettings: true, preferenceValue: null, consentStatus: "GRANTED" })
    ).toBe(true);
  });

  it("non-essential type is blocked when consent has been revoked, even with preference on", () => {
    expect(
      shouldAttemptExternalChannel({ type: "FOLLOWUP_REMINDER", channelEnabledInSettings: true, preferenceValue: true, consentStatus: "REVOKED" })
    ).toBe(false);
  });

  it("treats a missing consent row as granted", () => {
    expect(
      shouldAttemptExternalChannel({ type: "MEETING_SCHEDULED", channelEnabledInSettings: true, preferenceValue: true, consentStatus: null })
    ).toBe(true);
  });
});
