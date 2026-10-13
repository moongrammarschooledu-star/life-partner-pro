import { NextResponse } from "next/server";
import { appleTeamId, mobileIdentity } from "@/lib/mobile/config";
import { associatedPathPatterns } from "@/lib/mobile/deep-link";

export const dynamic = "force-dynamic";

// iOS Universal Links (STEP 37 §16): only the approved application routes (see ALLOWED_LINKS), never a catch-all. Served as JSON with no redirect, as Apple
// requires. Until the Apple Team ID is configured the list of apps is empty.
export async function GET() {
  const team = appleTeamId();
  const body = {
    applinks: {
      details: team ? [{ appIDs: [`${team}.${mobileIdentity().iosBundleId}`], components: associatedPathPatterns().map((p) => ({ "/": p })) }] : [],
    },
  };
  return new NextResponse(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
}