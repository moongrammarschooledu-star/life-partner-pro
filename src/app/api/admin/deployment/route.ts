import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getDeploymentInfo } from "@/lib/ops/deployment-info";

// STEP 34 - read-only deployment summary (version, commit, migration, health, backups, flags). No secrets are ever returned.
export const maxDuration = 60;

export async function GET() {
  try {
    await requireAdmin("readiness:view");
    return NextResponse.json(await getDeploymentInfo());
  } catch (error) {
    return handleApiError(error);
  }
}
