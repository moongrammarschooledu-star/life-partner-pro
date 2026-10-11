import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { socAudit } from "@/lib/soc/audit";
import { recordFinding } from "@/lib/soc/alerts";
import { collectObservations } from "@/lib/soc/collect";
import { activeConfigs, ensureRules } from "@/lib/soc/rule-service";
import { evaluateObservations } from "@/lib/soc/rules/engine";
import { RULES } from "@/lib/soc/rules/registry";
import { getSocSettings } from "@/lib/soc/settings";
import type { DetectionSummary } from "@/lib/soc/types";

// STEP 32 — one detection run: read what happened since the last run, apply every enabled rule's ACTIVE configuration, raise or update alerts.
// Reading never acts on a person: the only outputs are alerts (and the audit/run record). The window starts where the previous successful run
// ended, widened to at least the rule's own window and capped at 7 days, so nothing falls between two runs and a long gap is still bounded.

const MAX_LOOKBACK_MS = 7 * 86_400_000;
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000;

export type DetectionOutcome = { skipped: true; reason: string } | ({ skipped: false } & DetectionSummary);

export async function runDetection(opts: { trigger: "SCHEDULED" | "MANUAL"; actorId?: string | null; now?: Date; ruleKeys?: string[] } = { trigger: "SCHEDULED" }): Promise<DetectionOutcome> {
  if (!(await isFeatureEnabled("soc.enabled"))) return { skipped: true, reason: "Security Operations is not switched on." };
  if (!(await isFeatureEnabled("soc.detection.enabled"))) return { skipped: true, reason: "Threat detection is not switched on." };
  if (opts.trigger === "MANUAL" && !opts.actorId) throw new HttpError(500, "A manual run needs an actor.");

  const now = opts.now ?? new Date();
  const settings = await getSocSettings();
  await ensureRules();
  const configs = await activeConfigs();
  const base = settings.lastDetectionAt ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  const summary: DetectionSummary = { trigger: opts.trigger, from: base.toISOString(), to: now.toISOString(), rulesEvaluated: 0, findings: 0, alertsCreated: 0, alertsRepeated: 0, alertsSuppressed: 0, truncated: [], errors: [] };

  for (const def of RULES) {
    if (opts.ruleKeys && !opts.ruleKeys.includes(def.key)) continue;
    const cfg = configs.get(def.key)!;
    if (!cfg.enabled) continue;
    summary.rulesEvaluated++;
    try {
      const from = new Date(Math.max(Math.min(base.getTime(), now.getTime() - cfg.windowMinutes * 60_000), now.getTime() - MAX_LOOKBACK_MS));
      const read = await collectObservations(def, from, now);
      if (read.truncated) summary.truncated.push(def.key);
      const findings = evaluateObservations(def, read.observations, cfg);
      summary.findings += findings.length;
      for (const f of findings.slice(0, 200)) {
        const outcome = await recordFinding(def, cfg, f, settings, now);
        if (outcome === "CREATED") summary.alertsCreated++;
        else if (outcome === "REPEATED") summary.alertsRepeated++;
        else summary.alertsSuppressed++;
      }
    } catch (error) {
      summary.errors.push(`${def.key}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
    }
  }

  // The next run starts where this one ended — but only when every rule was read, otherwise the failed rule's window would be skipped.
  await prisma.socSettings.update({
    where: { id: 1 },
    data: { ...(summary.errors.length === 0 ? { lastDetectionAt: now } : {}), lastDetectionSummary: summary as unknown as Prisma.InputJsonValue },
  });
  await socAudit({ action: "SOC_DETECTION_RUN", actorId: opts.actorId ?? null, resource: "detection", resourceId: opts.trigger, after: { rules: summary.rulesEvaluated, findings: summary.findings, created: summary.alertsCreated, errors: summary.errors.length } });
  return { skipped: false, ...summary };
}
