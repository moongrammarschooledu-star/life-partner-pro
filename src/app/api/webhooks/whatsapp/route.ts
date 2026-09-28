import { NextResponse } from "next/server";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { handleWebhookRequest } from "@/lib/communications/webhook-route";
import { WhatsAppProviderAdapter } from "@/lib/communications/providers/whatsapp-adapter";

// Inbound WhatsApp (Meta Cloud API) webhook: rate limited, X-Hub-Signature-256 verified, idempotent (see webhook-service.ts).
export async function POST(req: Request) {
  const limited = await enforcePersistentLimit(req, "webhook-communications-whatsapp", 600, 60_000);
  if (limited) return limited;
  return handleWebhookRequest(req, "WHATSAPP");
}

// Meta's subscription handshake: echoes hub.challenge only when hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
export async function GET(req: Request) {
  const limited = await enforcePersistentLimit(req, "webhook-communications-whatsapp-verify", 60, 60_000);
  if (limited) return limited;
  const challenge = new WhatsAppProviderAdapter(process.env).verifyHandshake(new URL(req.url).searchParams);
  if (challenge === null) return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}
