import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { createRelease, listReleases, RELEASE_STATUSES } from "@/lib/mobile/release-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("platform:mobile:view");
    return NextResponse.json({ statuses: RELEASE_STATUSES, items: await listReleases() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("platform:mobile:manage");
    const body = await readJson<Record<string, unknown>>(req);
    requireReauth(admin, body.stepUpToken as string | undefined, "record an app release");
    return NextResponse.json(await createRelease(admin, { platform: body.platform, version: body.version, buildNumber: body.buildNumber, releaseNotes: body.releaseNotes, environment: body.environment, reason: body.reason }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}