import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { DRILL_ITEMS, listDrills, restoreProof, startDrill } from "@/lib/soc/restore-drills";
import { verifyBackup } from "@/lib/backup/verify";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("soc:backups:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-query", { limit: 600, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "VIEW", resource: "restore-drills" });
    return NextResponse.json({ items: await listDrills(), proof: await restoreProof(), checklist: DRILL_ITEMS }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

// POST { backupId, environmentLabel, isolatedConfirmed } — starts a drill and runs the automated verification. The application never
// restores anything itself: the restore is done with scripts/restore-backup.ts against an isolated database, then recorded here.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("soc:restore:record");
    await assertSocEnabled("soc.restore_drills.enabled");
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const b = await readBody(req, 5_000);
    await logSocAccess({ adminId: admin.id, action: "RUN", resource: "restore-drill" });
    const drill = await startDrill(admin.id, { backupId: str(b, "backupId", { required: true, max: 40 }), environmentLabel: str(b, "environmentLabel", { required: true, max: 80 }), isolatedConfirmed: b.isolatedConfirmed === true }, verifyBackup);
    return NextResponse.json(drill, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
