import { createHmac, timingSafeEqual } from "crypto";

// HMAC-SHA256 signature check for inbound provider webhooks (spec §28). No
// real provider exists in this environment to validate against — the admin
// "Simulate Webhook" action exercises this exact function.
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
