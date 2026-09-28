import { NextResponse } from "next/server";
import type { NotificationChannel } from "@prisma/client";
import { handleProviderWebhook } from "@/lib/communications/webhook-service";

// Shared body of the three provider webhook routes (/api/webhooks/email | sms | whatsapp). The route files stay one-liners so the
// route-coverage test can see the public-route protection (the persistent rate limit is applied in each route file; the signature
// check is inside handleProviderWebhook - an unsigned or badly signed request is rejected and audited, never processed).

const MAX_BODY_BYTES = 512 * 1024;

export async function handleWebhookRequest(req: Request, channel: NotificationChannel): Promise<NextResponse> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });

  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const outcome = await handleProviderWebhook(channel, { rawBody, headers, url: req.url });
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
