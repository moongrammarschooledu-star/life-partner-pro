import { NextResponse } from "next/server";
import { verifyEnvelope } from "@/lib/communications/providers/shared";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Inbound webhook for a future real document-processing provider (OCR, external scan). No such provider
// is configured today (see src/lib/documents/providers/noop-ocr-provider.ts) — this endpoint exists so the
// signed, rate-limited, replay-resistant pipeline is in place and testable ahead of one being connected.
// Fails CLOSED without DOCUMENT_WEBHOOK_SECRET: nobody can fabricate a document-provider event.
export async function POST(req: Request) {
  const limited = await enforcePersistentLimit(req, "webhook-document-provider", 300, 60_000);
  if (limited) return limited;
  const secret = process.env.DOCUMENT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "No document provider is configured." }, { status: 503 });

  const rawBody = await req.text();
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
  const verified = verifyEnvelope(headers, rawBody, secret);
  if (!verified.valid) return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });

  // No real provider integration exists yet to act on the payload; the signed envelope is accepted and
  // acknowledged so a future provider can be wired without re-doing the security plumbing.
  return NextResponse.json({ ok: true, processed: 0 });
}
