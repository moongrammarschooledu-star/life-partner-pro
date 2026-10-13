import { NextResponse } from "next/server";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { versionAnswer } from "@/lib/mobile/version-service";

export const dynamic = "force-dynamic";

// Public. "Is this app version still allowed?" The answer is the policy and a status word; the update address is only ever an official store page.
// An unreadable or invalid version is treated as the oldest possible one (so lying about the version cannot skip a required update).
export async function GET(req: Request) {
  try {
  const limited = await enforceConfiguredLimit(req, "mobile-public", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const url = new URL(req.url);
  const p = (url.searchParams.get("platform") ?? "").toUpperCase();
  if (p !== "ANDROID" && p !== "IOS") return NextResponse.json({ error: "Unknown platform." }, { status: 400 });
  const enabled = (await isFeatureEnabled("mobile.app.enabled")) && (await isFeatureEnabled(p === "ANDROID" ? "mobile.android.enabled" : "mobile.ios.enabled"));
  const answer = await versionAnswer(p, url.searchParams.get("version"));
  return NextResponse.json({ ...answer, enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The app treats this as "could not check" and keeps working; it never blocks a person because the check failed.
    return NextResponse.json({ error: "Could not check the version right now." }, { status: 503 });
  }
}