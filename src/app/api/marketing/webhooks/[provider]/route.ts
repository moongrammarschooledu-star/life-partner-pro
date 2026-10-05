import { NextResponse } from "next/server";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { handleMarketingWebhook, handleWebhookHandshake } from "@/lib/marketing/webhook-service";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

// Public provider callback (Meta Lead Ads `leadgen`, WhatsApp inbound messages). The signature is verified over the RAW
// body inside handleMarketingWebhook before anything is parsed; a bad signature is a flat 401 with no detail. With the
// marketing flags off a validly signed delivery is acknowledged (200 {skipped:true}) so the provider does not retry-storm.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const limited = await enforceConfiguredLimit(req, "marketing-webhook", { limit: 600, windowMs: 60_000 });
  if (limited) return limited;
  const { provider } = await params;
  const result = handleWebhookHandshake(provider, new URL(req.url).searchParams);
  if (result.challenge !== undefined) return new NextResponse(result.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const limited = await enforceConfiguredLimit(req, "marketing-webhook", { limit: 600, windowMs: 60_000 });
  if (limited) return limited;
  const { provider } = await params;
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });

  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const result = await handleMarketingWebhook(provider, { rawBody, headers, url: req.url });
  return NextResponse.json(result.body, { status: result.status });
}
