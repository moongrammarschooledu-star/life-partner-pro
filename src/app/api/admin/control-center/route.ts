import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { controlCenterOverview } from "@/lib/platform/overview";
import { sectionsFor } from "@/lib/platform/sections";

export const dynamic = "force-dynamic";

// The Control Center dashboard. Sections are computed only for the permissions the caller holds (see overview.ts).
export async function GET() {
  try {
    const admin = await requireAdmin("platform:control_center:view");
    const overview = await controlCenterOverview(admin);
    return NextResponse.json({ ...overview, navigation: sectionsFor(admin.permissions).map((s) => ({ key: s.key, label: s.label, group: s.group, href: s.page ?? `/admin/control-center/${s.key}` })) });
  } catch (error) {
    return handleApiError(error);
  }
}