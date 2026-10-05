import { NextResponse } from "next/server";
import { blockedResponse } from "@/lib/ops/guards";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { getPublishedForm } from "@/lib/marketing/form-service";
import { issueFormToken } from "@/lib/marketing/tokens";

export const dynamic = "force-dynamic";

// Public. Mints the signed, version-bound form token (nonce + issue time) the submit route requires. Minted here, not
// in the landing page HTML, so cached or stale HTML can never carry an expired/reused token.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await blockedResponse({ flags: ["marketing.enabled", "marketing.lead_capture.enabled"] });
  if (blocked) return blocked;
  const limited = await enforceConfiguredLimit(req, "marketing-form-token", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await params;
  const published = await getPublishedForm(id).catch(() => null);
  if (!published) return NextResponse.json({ error: "This form is not available." }, { status: 404 });
  return NextResponse.json({ token: issueFormToken({ formId: published.form.id, formVersionId: published.version.id }) }, { headers: { "Cache-Control": "no-store" } });
}
