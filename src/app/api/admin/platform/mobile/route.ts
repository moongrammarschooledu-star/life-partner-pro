import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { adminDeviceSummaries, mobileOverview } from "@/lib/mobile/admin-service";

export const dynamic = "force-dynamic";

// The Mobile Apps overview: counts and statuses only (no push token, no person).
export async function GET() {
  try {
    const admin = await requireAdmin("platform:mobile:view");
    const [overview, devices] = await Promise.all([mobileOverview(), adminDeviceSummaries(30).catch(() => [])]);
    return NextResponse.json({ environment: currentEnvironment(), ...overview, recentDevices: devices, canManage: admin.permissions.includes("platform:mobile:manage"), canPush: admin.permissions.includes("platform:mobile:push") });
  } catch (error) {
    return handleApiError(error);
  }
}