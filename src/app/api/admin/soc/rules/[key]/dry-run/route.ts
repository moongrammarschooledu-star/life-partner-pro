import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { assertSocEnabled, currentViewer } from "@/lib/soc/route-helpers";
import { logSocAccess } from "@/lib/soc/audit";
import { dryRunRule } from "@/lib/soc/rule-service";
import { marketingError, noStore, readBody } from "@/lib/marketing/route-utils";
import type { RuleConfig } from "@/lib/soc/types";

// POST { days?, config? } — what WOULD this configuration have raised over the past days? Reads only; creates no alert and changes no rule.
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("soc:rules:view");
    await assertSocEnabled();
    const limited = await enforceConfiguredLimit(req, "soc-action", { limit: 120, windowMs: 3_600_000 }, admin.id);
    if (limited) return limited;
    const { key } = await params;
    const b = await readBody(req, 5_000);
    const cfg = (b.config && typeof b.config === "object" ? b.config : {}) as Partial<RuleConfig>;
    await logSocAccess({ adminId: admin.id, action: "RUN", resource: "rule-dry-run", resourceId: key });
    return NextResponse.json(await dryRunRule(await currentViewer(admin.id), key, { days: typeof b.days === "number" ? b.days : undefined, config: { threshold: cfg.threshold, windowMinutes: cfg.windowMinutes, severity: cfg.severity } }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
