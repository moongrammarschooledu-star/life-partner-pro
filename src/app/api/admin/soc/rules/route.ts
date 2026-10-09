import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { listRules } from "@/lib/soc/rule-service";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Every detection rule with its ACTIVE configuration and any change waiting for a second reviewer.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:rules:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "rules" });
    return NextResponse.json({ items: await listRules() }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
