import { prisma } from "@/lib/prisma";
import type { NotificationChannel } from "@prisma/client";
import { maskEmail, maskPhone } from "@/lib/verification/otp";
import { eligibleFailoverChain, resolveProviderChain } from "@/lib/communications/providers/registry";
import { recordProviderOutcome } from "@/lib/communications/provider-health";

// One-time codes (admin login, applicant e-mail / phone verification). The rules that make this different from an ordinary send:
//   - the code is in the message body, so it is NEVER stored: the optional status row has no body;
//   - it goes through the same provider registry and environment guard as everything else, and a failure THROWS, so the caller can
//     never claim a code was sent when it was not;
//   - production logs never contain the code (adapters redact it unless COMMUNICATION_DEBUG_OTP=true).
// OTPs are security messages, so the policy engine's marketing rules (frequency, quiet hours, ...) deliberately do not apply: the
// OTP service has its own expiry, attempt and resend limits.

export interface OneTimeCodeRequest {
  channel: Exclude<NotificationChannel, "IN_APP">;
  to: string;
  subject?: string;
  body: string;
  profileId?: string; // when known, a body-less delivery-status row is written for the applicant's communication history
}

export class OtpDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpDeliveryError";
  }
}

export async function sendOneTimeCode(req: OneTimeCodeRequest): Promise<{ providerKey: string; providerMessageId?: string }> {
  const chain = await eligibleFailoverChain(await resolveProviderChain({ channel: req.channel, destination: req.to }));
  let lastError = "delivery failed";
  for (const candidate of chain) {
    const check = candidate.adapter.validateRecipient(req.to);
    if (!check.valid) throw new OtpDeliveryError(`Invalid ${req.channel === "EMAIL" ? "e-mail address" : "phone number"}.`);
    const result = await candidate.adapter.sendOTP({ to: check.normalized ?? req.to, body: req.body, subject: req.subject, purpose: "OTP" });
    await recordProviderOutcome(candidate.providerKey, { ok: result.ok, error: result.error }).catch(() => {});
    if (result.ok) {
      if (req.profileId) await recordStatusRow(req, candidate.providerKey, result.providerMessageId).catch(() => {});
      return { providerKey: candidate.providerKey, providerMessageId: result.providerMessageId };
    }
    lastError = result.error ?? lastError;
    if (result.failureClass === "PERMANENT") break; // a permanent answer will not change on another provider for the same recipient
  }
  throw new OtpDeliveryError(lastError);
}

async function recordStatusRow(req: OneTimeCodeRequest, providerKey: string, providerMessageId?: string) {
  const now = new Date();
  await prisma.communicationLog.create({
    data: {
      profileId: req.profileId as string,
      channel: req.channel,
      notificationType: req.channel === "EMAIL" ? "EMAIL_VERIFIED" : "MOBILE_VERIFIED",
      templateKey: "OTP",
      recipientReference: req.channel === "EMAIL" ? maskEmail(req.to) : maskPhone(req.to),
      messageBody: null, // never the code
      deliveryStatus: "SENT",
      sentAt: now,
      queuedAt: now,
      purpose: "OTP",
      messageType: "SECURITY",
      recipientType: "PROFILE",
      provider: providerKey,
      providerMessageId: providerMessageId ?? null,
      attempts: 1,
    },
  });
}
