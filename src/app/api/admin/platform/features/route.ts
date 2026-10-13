import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { SPEC_FLAGS, listFlagViews } from "@/lib/platform/flags";
import { listKillSwitches } from "@/lib/platform/killswitch";
import { FLAG_STATES, TARGET_TYPES } from "@/lib/platform/flag-eval";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = await requireAdmin("platform:features:view");
    const [flags, killSwitches] = await Promise.all([listFlagViews(), listKillSwitches()]);
    return NextResponse.json({
      environment: currentEnvironment(),
      states: FLAG_STATES,
      targetTypes: TARGET_TYPES,
      items: flags,
      specFlags: SPEC_FLAGS,
      killSwitches,
      canManage: admin.permissions.includes("platform:features:manage"),
      propagationNote: "A change reaches every server instance within about 30 seconds.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}