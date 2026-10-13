import { NextResponse } from "next/server";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { isSameOrigin } from "@/lib/marketing/origin";
import { optedOutOfTracking } from "@/lib/public-site/site-events";
import { recordMobileEvents } from "@/lib/mobile/analytics";

export const dynamic = "force-dynamic";

// Anonymous, aggregate app usage counts (a fixed list of event names). Off unless MOBILE_ANALYTICS_ENABLED=true; answers "ok" for anything it does not record.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const limited = await enforceConfiguredLimit(req, "mobile-events", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  if (optedOutOfTracking(req.headers)) return NextResponse.json({ ok: true });
  const raw = await req.text();
  if (raw.length > 2048) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let json: { platform?: unknown; appVersion?: unknown; events?: unknown } | null = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!json || typeof json !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  await recordMobileEvents({ platform: json.platform, appVersion: json.appVersion, events: json.events }).catch(() => ({ recorded: 0 }));
  return NextResponse.json({ ok: true });
}