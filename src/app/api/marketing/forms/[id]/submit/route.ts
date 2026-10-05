import { NextResponse } from "next/server";
import { z } from "zod";
import { blockedResponse } from "@/lib/ops/guards";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { captureLead } from "@/lib/marketing/lead-capture-service";
import { computeContactHashes } from "@/lib/marketing/normalize";
import { isSameOrigin } from "@/lib/marketing/origin";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;

const bodySchema = z.object({
  token: z.string().min(10).max(600),
  touch: z.string().max(1500).nullish(),
  values: z.record(z.string().max(40), z.unknown()).refine((v) => Object.keys(v).length <= 16, "Too many fields."),
  consents: z.object({ inquiryContact: z.boolean(), marketingUpdates: z.boolean().optional(), whatsapp: z.boolean().optional() }),
  hp: z.string().max(200).nullish(),
});

// Public lead-form submission. Every response for an accepted, repeated, suppressed, flagged or silently-rejected
// submission is the SAME `{ ok: true }` — the caller cannot learn whether a contact already exists or is suppressed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await blockedResponse({ flags: ["marketing.enabled", "marketing.lead_capture.enabled"] });
  if (blocked) return blocked;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const limited = await enforceConfiguredLimit(req, "marketing-form-submit", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large." }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const body = parsed.data;

    // A per-destination limit stops one number/email being used to flood the pipeline from many IPs.
    const v = body.values as Record<string, unknown>;
    const hashes = computeContactHashes({ phone: typeof v.phone === "string" ? v.phone : typeof v.whatsapp === "string" ? v.whatsapp : null, email: typeof v.email === "string" ? v.email : null });
    const destination = hashes.phoneHash ?? hashes.emailHash;
    if (destination) {
      const dlimited = await enforceConfiguredLimit(req, "marketing-form-submit-destination", { limit: 3, windowMs: 3_600_000 }, destination);
      if (dlimited) return dlimited;
    }

    const { id } = await params;
    const result = await captureLead({
      formId: id, formToken: body.token, touchToken: body.touch ?? null, values: v, consents: body.consents, honeypot: body.hp ?? null,
      clientKey: clientKeyFromRequest(req),
    });
    switch (result.status) {
      case "ACCEPTED":
        return NextResponse.json({ ok: true });
      case "INVALID":
        return NextResponse.json({ error: "Please check your details and try again.", detail: result.reason }, { status: 400 });
      case "STALE_TOKEN":
        return NextResponse.json({ error: "This form has expired. Please reload the page and try again.", code: "STALE_TOKEN" }, { status: 400 });
      case "UNAVAILABLE":
        return NextResponse.json({ error: "This form is not available." }, { status: 404 });
    }
  } catch (error) {
    console.error("[marketing] submit failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
