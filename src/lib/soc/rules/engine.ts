import type { Finding, Observation, Point, RuleConfig, RuleDefinition, SocSeverity } from "@/lib/soc/types";
import { severityRank } from "@/lib/soc/types";

// STEP 32 — the PURE half of detection: given what was seen and a rule's configuration, decide what is a finding. No database, no clock, no
// randomness, so every rule is testable with a handful of timestamps. The text it produces holds counts and windows only.

export interface Peak {
  peak: number;
  windowStart: number;
  windowEnd: number;
  refs: string[];
}

// The highest count (or distinct-key count) inside ANY rolling window of `windowMs`. Because a daily job looks back over the whole period
// since its last run, a burst that happened at 03:10 is still found at 08:00 — a fixed "last hour" window would miss it.
export function rollingPeak(points: Point[], windowMs: number, distinct: boolean): Peak {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const counts = new Map<string, number>();
  let left = 0;
  let best: Peak = { peak: 0, windowStart: 0, windowEnd: 0, refs: [] };
  const size = () => (distinct ? counts.size : right - left + 1);
  let right = 0;
  for (right = 0; right < sorted.length; right++) {
    const k = sorted[right].key ?? "";
    counts.set(k, (counts.get(k) ?? 0) + 1);
    while (sorted[right].t - sorted[left].t > windowMs) {
      const lk = sorted[left].key ?? "";
      const n = (counts.get(lk) ?? 1) - 1;
      if (n <= 0) counts.delete(lk);
      else counts.set(lk, n);
      left++;
    }
    const s = size();
    if (s > best.peak) {
      best = {
        peak: s,
        windowStart: sorted[left].t,
        windowEnd: sorted[right].t,
        refs: sorted.slice(left, right + 1).map((p) => p.ref).filter((r): r is string => !!r),
      };
    }
  }
  return best;
}

const EVIDENCE_LIMIT = 10;

export function evaluateObservations(def: RuleDefinition, observations: Observation[], cfg: RuleConfig): Finding[] {
  if (!cfg.enabled) return [];
  const windowMs = cfg.windowMinutes * 60_000;
  const distinct = def.query.kind === "events" && !!def.query.distinctBy;
  const out: Finding[] = [];
  for (const obs of observations) {
    if (obs.points.length < cfg.threshold) continue; // cheap skip: fewer points than the threshold can never reach it (counted or distinct)
    const p = rollingPeak(obs.points, windowMs, distinct);
    if (p.peak < cfg.threshold) continue;
    out.push({
      subject: obs.subject,
      resource: obs.resource,
      observed: p.peak,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      summary: `${p.peak} ${def.unit} within ${cfg.windowMinutes} minutes (threshold ${cfg.threshold}).`,
      evidence: p.refs.slice(0, EVIDENCE_LIMIT).map((id) => ({ type: evidenceType(def), id })),
    });
  }
  // Largest first, so a capped list always shows the most significant findings.
  return out.sort((a, b) => b.observed - a.observed);
}

function evidenceType(def: RuleDefinition): string {
  return def.query.kind === "events" ? "SecurityEvent" : def.query.kind === "aiDenied" ? "AiRequest" : "BackupRun";
}

// ---- versions: when does a change make a rule WEAKER? ----
// Weaker = harder to trigger or quieter. For a count-above-threshold rule that is: switched off, lower severity, higher threshold, or a
// shorter window. Weakening a protected rule (or any rule currently HIGH or above) needs a second person to approve it.
export function isWeakening(prev: RuleConfig, next: RuleConfig): boolean {
  if (prev.enabled && !next.enabled) return true;
  if (severityRank(next.severity) < severityRank(prev.severity)) return true;
  if (next.threshold > prev.threshold) return true;
  if (next.windowMinutes < prev.windowMinutes) return true;
  return false;
}

export function needsSecondReviewer(def: Pick<RuleDefinition, "protectedRule">, prev: RuleConfig, next: RuleConfig): boolean {
  if (!isWeakening(prev, next)) return false;
  return def.protectedRule || severityRank(prev.severity) >= severityRank("HIGH" as SocSeverity);
}

export const RULE_BOUNDS = { thresholdMin: 1, thresholdMax: 100_000, windowMin: 5, windowMax: 7 * 24 * 60 } as const;

export function validateRuleConfig(c: Partial<RuleConfig>, base: RuleConfig): { ok: true; config: RuleConfig } | { ok: false; error: string } {
  const next: RuleConfig = { ...base, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } as RuleConfig;
  if (typeof next.enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
  if (!["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(next.severity)) return { ok: false, error: "Unknown severity." };
  if (!Number.isInteger(next.threshold) || next.threshold < RULE_BOUNDS.thresholdMin || next.threshold > RULE_BOUNDS.thresholdMax) return { ok: false, error: `Threshold must be a whole number from ${RULE_BOUNDS.thresholdMin} to ${RULE_BOUNDS.thresholdMax}.` };
  if (!Number.isInteger(next.windowMinutes) || next.windowMinutes < RULE_BOUNDS.windowMin || next.windowMinutes > RULE_BOUNDS.windowMax) return { ok: false, error: `Window must be a whole number of minutes from ${RULE_BOUNDS.windowMin} to ${RULE_BOUNDS.windowMax}.` };
  return { ok: true, config: next };
}
