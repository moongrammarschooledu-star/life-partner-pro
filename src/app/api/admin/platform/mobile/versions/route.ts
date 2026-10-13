import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { setVersionPolicy } from "@/lib/mobile/version-service";

export const dynamic = "force-dynamic";

// Set the minimum / recommended / latest app version for one platform. Raising the minimum locks older apps out until they update: it needs a reason, the
// environment named, a fresh password confirmation, and respects the change freeze.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("platform:mobile:manage");
    const body = await readJson<Record<string, unknown>>(req);
    requireReauth(admin, body.stepUpToken as string | undefined, "change the app versions");
    return NextResponse.json(await setVersionPolicy(admin, { platform: body.platform, minimumSupportedVersion: body.minimumSupportedVersion, recommendedVersion: body.recommendedVersion, latestVersion: body.latestVersion, storeUrl: body.storeUrl, reason: body.reason, environment: body.environment }));
  } catch (error) {
    return handleApiError(error);
  }
}