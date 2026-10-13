import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { exportConfiguration } from "@/lib/platform/search-export";

export const dynamic = "force-dynamic";

// Safe configuration export: metadata only, no credentials or secret names, and there is no matching import. Audited; one export per administrator per minute.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("platform:configuration:manage");
    const limited = await enforceConfiguredLimit(req, "platform-export", { limit: 6, windowMs: 60_000 }, `export:${admin.id}`);
    if (limited) return limited;
    const data = await exportConfiguration(admin);
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="lpp-configuration-export.json"', "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}