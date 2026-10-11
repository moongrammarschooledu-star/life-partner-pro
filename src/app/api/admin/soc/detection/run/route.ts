import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { runDetection } from "@/lib/soc/detection";
import { runEscalation } from "@/lib/soc/escalation";
import { getSocSettings } from "@/lib/soc/settings";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

export const maxDuration = 60;

// "Run now": the same run the daily job performs, started by hand. Reading only produces alerts — it never acts on a person.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("soc:detection:run");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-detection-run", { limit: 12, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    await logSocAccess({ adminId: admin.id, action: "RUN", resource: "detection" });
    const detection = await runDetection({ trigger: "MANUAL", actorId: admin.id });
    const escalation = await runEscalation(await getSocSettings());
    return NextResponse.json({ detection, escalation }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
