import { NextResponse } from "next/server";
import { blockedResponse } from "@/lib/ops/guards";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { recordMarketingEvent } from "@/lib/marketing/events";
import { isSameOrigin } from "@/lib/marketing/origin";
import { optedOutOfTracking, recordablePath, siteEventSchema } from "@/lib/public-site/site-events";

export const dynamic = "force-dynamic";

// Anonymous public-site beacon (page view, call-to-action click, registration started). Switched off by default (marketing.site_events.enabled).
// Same-origin only, rate limited, 2 KB cap, strict validation, and it answers 204-style "ok" for anything it chooses not to record, so a caller
// learns nothing. Visitors who send Do Not Track or Global Privacy Control are not counted. Only a public page path is stored, never a query
// string, an address, an agent string or a profile; the visitor key is a salted hash made here.
export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["marketing.enabled", "marketing.site_events.enabled"] });
  if (blocked) return blocked;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const limited = await enforceConfiguredLimit(req, "marketing-events", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  if (optedOutOfTracking(req.headers)) return NextResponse.json({ ok: true });

  const raw = await req.text();
  if (raw.length > 2048) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = siteEventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const path = recordablePath(parsed.data.path);
  if (path) {
    await recordMarketingEvent({ type: parsed.data.type, path, variantKey: parsed.data.cta ?? null, subject: clientKeyFromRequest(req) });
  }
  return NextResponse.json({ ok: true });
}
