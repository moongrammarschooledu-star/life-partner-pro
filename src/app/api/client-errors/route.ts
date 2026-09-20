import { NextResponse } from "next/server";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability/error-capture";
import { getCorrelationId } from "@/lib/observability/correlation";
import { redactString } from "@/lib/observability/redact";

// Frontend error intake (spec §13). Public by necessity (any visitor's browser
// may report), so: tight rate limit, tiny body, and only opaque, redacted
// fields are accepted — never a stack, message body, URL query or user data.
export async function POST(req: Request) {
  if (!rateLimit(`client-errors:${clientKeyFromRequest(req)}`, 10, 60_000)) {
    return NextResponse.json({ ok: true }); // silent: never help an attacker tune a flood
  }
  const text = await req.text();
  if (text.length > 2000) return NextResponse.json({ ok: true });

  let body: { digest?: unknown; name?: unknown; path?: unknown; fatal?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const digest = typeof body.digest === "string" ? body.digest.slice(0, 40) : "none";
  const name = typeof body.name === "string" ? body.name.slice(0, 40) : "Error";
  // Path only — the query string can carry tokens/ids and is dropped.
  const path = typeof body.path === "string" ? redactString(body.path.split("?")[0].slice(0, 120), 120) : "unknown";

  await captureError({
    error: new Error(`Client render error ${name} (digest ${digest})`),
    route: path,
    service: "FRONTEND",
    category: "SYSTEM_ERROR",
    severity: body.fatal === true ? "HIGH" : "LOW",
    correlationId: await getCorrelationId(),
  });
  return NextResponse.json({ ok: true });
}
