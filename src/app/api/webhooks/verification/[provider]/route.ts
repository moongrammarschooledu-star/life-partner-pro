import { NextResponse } from "next/server";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { processVerificationWebhook } from "@/lib/verification/provider/webhook";

// Public but signature-gated (spec §9/§37) — mirrors
// src/app/api/webhooks/payments/[provider]/route.ts's exact shape.
// requireAdmin() is intentionally never called here: a webhook has no admin
// session, its authenticity comes entirely from the provider signature.
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const limited = await enforcePersistentLimit(req, "webhook-verification", 300, 60_000);
  if (limited) return limited;

  await params; // the provider name in the URL is informational only — getVerificationProvider() reads the configured provider server-side, never a client-supplied path segment

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-verification-signature");

  const outcome = await processVerificationWebhook(rawBody, signatureHeader, req.headers);
  if (!outcome.ok) {
    // 401/400 for a rejected signature/payload; a processing error still
    // returns 200 so the provider doesn't retry-storm a delivery that was
    // already durably recorded (matches the payment webhook's convention).
    return NextResponse.json({ error: outcome.error }, { status: outcome.status === 500 ? 200 : outcome.status });
  }
  return NextResponse.json({ ok: true, duplicate: outcome.duplicate ?? false });
}
