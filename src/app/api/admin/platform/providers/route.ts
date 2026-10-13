import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { listProviderViews } from "@/lib/platform/providers";
import { PROVIDER_STATUSES } from "@/lib/platform/provider-status";

export const dynamic = "force-dynamic";

// Safe metadata only: names, status, environment, last check, enabled features. No credential, token, key or secret name is ever part of this response.
export async function GET() {
  try {
    const admin = await requireAdmin("platform:providers:view");
    const items = await listProviderViews();
    return NextResponse.json({ environment: currentEnvironment(), statuses: PROVIDER_STATUSES, items, canManage: admin.permissions.includes("platform:providers:manage") });
  } catch (error) {
    return handleApiError(error);
  }
}