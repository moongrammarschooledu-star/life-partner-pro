import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { setVerificationStatus } from "@/lib/verification/status";
import { getVerificationProvider } from "./index";
import type { VerificationResultStatus } from "./types";
import type { VerificationStatus } from "@prisma/client";

export type WebhookOutcome = { ok: true; duplicate?: boolean } | { ok: false; status: number; error: string };

// A provider webhook can move status toward a review state at most — it can
// never itself reach VERIFIED. VERIFIED is only ever reached through the
// existing, STEP-19-approval-gated admin verification:approve action (see
// src/app/api/admin/profiles/[id]/verification/actions/route.ts), regardless
// of what the provider itself reports (plan decision 7). EXPIRED/CANCELLED
// are not human decisions about the person at all — just a lapsed/ended
// session — so those two are safe to reflect automatically.
function mapProviderStatusToInternal(status: VerificationResultStatus): VerificationStatus | null {
  switch (status) {
    case "APPROVED":
    case "REJECTED":
      return "UNDER_REVIEW";
    case "REQUIRES_INPUT":
      return "VERIFICATION_REQUIRED";
    case "EXPIRED":
      return "VERIFICATION_EXPIRED";
    case "CANCELLED":
    case "PENDING":
    case "IN_PROGRESS":
    default:
      return null;
  }
}

// Extracted so the dedupe/security/processing logic is unit-testable without
// a real HTTP request — mirrors the payment webhook route's inline logic
// (src/app/api/webhooks/payments/[provider]/route.ts) but as a reusable
// function, following this codebase's established route-logic-extraction
// discipline (e.g. submitProposalResponse).
export async function processVerificationWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookOutcome> {
  const provider = getVerificationProvider();
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  const signatureValid = provider.verifyWebhook(rawBody, signatureHeader);
  if (!signatureValid) {
    await writeAudit({ action: "PROVIDER_WEBHOOK_REJECTED", meta: { provider: provider.name, reason: "invalid_signature", payloadHash } });
    return { ok: false, status: 401, error: "Invalid signature" };
  }

  const event = provider.parseWebhookEvent(rawBody);
  if (!event) {
    await writeAudit({ action: "PROVIDER_WEBHOOK_REJECTED", meta: { provider: provider.name, reason: "malformed_payload", payloadHash } });
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  // Idempotency/replay guard — a unique-constraint violation on
  // (provider, providerEventId) means this exact event was already recorded,
  // so it is never reprocessed (same @@unique-as-idempotency pattern as
  // PaymentWebhookEvent).
  let eventRow;
  try {
    eventRow = await prisma.verificationProviderEvent.create({
      data: { provider: provider.name, providerEventId: event.providerEventId, eventType: event.eventType, payloadHash, signatureValid: true },
    });
  } catch {
    return { ok: true, duplicate: true };
  }

  await writeAudit({ action: "PROVIDER_WEBHOOK_RECEIVED", meta: { provider: provider.name, eventType: event.eventType } });

  try {
    if (event.sessionId && event.status) {
      const verification = await prisma.profileVerification.findFirst({ where: { providerSessionId: event.sessionId } });
      if (verification) {
        await prisma.profileVerification.update({ where: { id: verification.id }, data: { providerStatus: event.status } });

        // STEP 24 — only a genuine REJECTION counts toward the verification-review rule; provider errors,
        // timeouts, expiry and "needs more input" are never risk signals. Replay-safe via the provider event id.
        if (event.status === "REJECTED") {
          await publishSecurityEvent({ eventType: "VERIFICATION_FAILED", profileId: verification.profileId, source: "verification-provider", outcome: "REJECTED", idempotencyKey: `verification-failed:${provider.name}:${event.providerEventId}` });
        }

        const nextStatus = mapProviderStatusToInternal(event.status);
        if (nextStatus) {
          await setVerificationStatus(verification.profileId, nextStatus, {});
        }
      }
    }

    await prisma.verificationProviderEvent.update({ where: { id: eventRow.id }, data: { processed: true, processedAt: new Date() } });
    return { ok: true };
  } catch {
    // The event row stays `processed: false` — an unprocessed row is visible
    // to admins via the Provider Events surface for follow-up, never silently
    // dropped, matching this codebase's observability convention elsewhere.
    return { ok: false, status: 500, error: "Processing error" };
  }
}
