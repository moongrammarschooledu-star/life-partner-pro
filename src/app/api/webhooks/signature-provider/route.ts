import { NextResponse } from "next/server";
import { verifyEnvelope } from "@/lib/communications/providers/shared";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Inbound webhook for a future real e-signature provider (DocuSign-shaped). The default
// LocalSignatureProvider is entirely in-app and never calls out, so nothing calls back here today — this
// endpoint exists so the signed, rate-limited, replay-resistant pipeline is ready ahead of one being
// connected. Fails CLOSED without SIGNATURE_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const limited = await enforcePersistentLimit(req, "webhook-signature-provider", 300, 60_000);
  if (limited) return limited;
  const secret = process.env.SIGNATURE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "No e-signature provider is configured." }, { status: 503 });

  const rawBody = await req.text();
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
  const verified = verifyEnvelope(headers, rawBody, secret);
  if (!verified.valid) return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });

  return NextResponse.json({ ok: true, processed: 0 });
}
