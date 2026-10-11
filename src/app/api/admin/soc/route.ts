import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { socOverview } from "@/lib/soc/overview";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Security Operations overview: database-backed counts and statuses with their source and "as of" time. No estimates, no placeholders.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "overview" });
    return NextResponse.json(await socOverview(), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
