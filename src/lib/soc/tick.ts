import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { runDetection, type DetectionOutcome } from "@/lib/soc/detection";
import { runEscalation, type EscalationResult } from "@/lib/soc/escalation";
import { getSocSettings } from "@/lib/soc/settings";

// STEP 32 — the Security Operations part of the daily tick (and "Run now"). Everything is gated by its own switch; with the switches off this
// does nothing and reads nothing. A failure in one step never stops the next: the daily tick must keep running.

export interface SocTickResult {
  detection: DetectionOutcome | { error: string } | null;
  escalation: EscalationResult | { error: string } | null;
}

export async function runSocTick(now: Date = new Date()): Promise<SocTickResult> {
  const out: SocTickResult = { detection: null, escalation: null };
  if (!(await isFeatureEnabled("soc.enabled"))) return out;
  try {
    out.detection = await runDetection({ trigger: "SCHEDULED", now });
  } catch (e) {
    out.detection = { error: e instanceof Error ? e.message.slice(0, 160) : "detection failed" };
  }
  try {
    out.escalation = await runEscalation(await getSocSettings(), now);
  } catch (e) {
    out.escalation = { error: e instanceof Error ? e.message.slice(0, 160) : "escalation failed" };
  }
  return out;
}
