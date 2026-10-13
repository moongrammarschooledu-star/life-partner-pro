import { NextResponse } from "next/server";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { isFeatureEnabledFor } from "@/lib/ops/feature-flags";
import { getPublicState } from "@/lib/ops/system-control";
import { mobileIdentity } from "@/lib/mobile/config";

export const dynamic = "force-dynamic";

const FLAGS = ["app", "android", "ios", "push", "deep_links", "biometric", "new_dashboard", "payments", "maintenance"] as const;

// Public. Which app features the server currently allows. Server controlled only: the app never decides this itself. The installation id (when sent) lets a
// percentage rollout give the same answer every time to the same installed app; it is not stored.
export async function GET(req: Request) {
  try {
  const limited = await enforceConfiguredLimit(req, "mobile-public", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const url = new URL(req.url);
  const platform = (url.searchParams.get("platform") ?? "").toUpperCase();
  const installationId = url.searchParams.get("installationId") ?? "";
  const subject = /^[A-Za-z0-9_-]{16,64}$/.test(installationId) ? { id: installationId } : {};
  const flags: Record<string, boolean> = {};
  for (const f of FLAGS) flags[f] = await isFeatureEnabledFor(`mobile.${f}.enabled`, subject);
  const state = await getPublicState().catch(() => null);
  const id = mobileIdentity();
  return NextResponse.json(
    {
      flags,
      platformEnabled: platform === "ANDROID" ? flags.android : platform === "IOS" ? flags.ios : true,
      maintenance: flags.maintenance || !!state?.blocked,
      readOnly: !!state?.readOnly,
      message: state?.blocked || state?.readOnly ? state.message : "",
      links: { privacy: "/privacy-policy", terms: "/terms", support: "/support", status: "/status", accountDeletion: "/account-settings" },
      appUrl: id.appUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  } catch {
    return NextResponse.json({ error: "Could not read the settings right now." }, { status: 503 });
  }
}