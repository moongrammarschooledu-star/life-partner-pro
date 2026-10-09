import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { backupOverview } from "@/lib/soc/backups";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Backup status as the records say it is. Never returns a storage location, a key or any file content.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:backups:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "backups" });
    return NextResponse.json(await backupOverview(), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
