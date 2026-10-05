import { NextResponse } from "next/server";
import { z } from "zod";
import { blockedResponse } from "@/lib/ops/guards";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { recordMarketingEvent } from "@/lib/marketing/events";
import { isSameOrigin } from "@/lib/marketing/origin";
import { verifyTouchToken } from "@/lib/marketing/tokens";

export const dynamic = "force-dynamic";

// Only events the landing page can legitimately observe in the browser.
const bodySchema = z.object({ type: z.enum(["LANDING_PAGE_VIEW", "CTA_CLICK", "FORM_STARTED"]), touch: z.string().min(10).max(1500) });

// Public first-party beacon. Requires a SERVER-SIGNED touch token (so an event can only be attributed to a campaign /
// page / variant the server itself rendered), is same-origin only, rate limited, and stores nothing personal: the
// visitor key is a salted hash of the client address, never the address.
export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["marketing.enabled", "marketing.public_pages.enabled"] });
  if (blocked) return blocked;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const limited = await enforceConfiguredLimit(req, "marketing-events", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = await req.text();
  if (raw.length > 4000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const touch = verifyTouchToken(parsed.data.touch);
  if (!touch.valid) return NextResponse.json({ ok: true }); // unsigned/tampered: acknowledged, never recorded

  await recordMarketingEvent({
    type: parsed.data.type,
    campaignId: touch.claims.campaignId,
    landingPageId: touch.claims.pageId,
    variantKey: touch.claims.variantKey ?? null,
    subject: clientKeyFromRequest(req),
  });
  return NextResponse.json({ ok: true });
}
