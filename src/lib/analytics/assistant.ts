import { METRICS } from "@/lib/analytics/metrics/registry";
import type { AnalyticsQuery } from "@/lib/analytics/query";
import type { PeriodPreset } from "@/lib/analytics/time";
import type { MetricDefinition, MetricResult } from "@/lib/analytics/types";

// STEP 31 — the analytics assistant's brain. PURE (no database, no network): it turns a question into a structured AnalyticsQuery by
// matching words against the metric catalog's names and synonyms, and turns a result back into plain sentences. There is no model and
// no SQL anywhere in this path; text that is not a recognised metric, dimension or period is simply ignored, and anything that looks
// like a database command, a prompt-injection attempt, or a request to predict a person is refused with an explanation.
//
//   question -> intent -> metric selection -> dimension -> period -> (caller) permission check -> engine -> explanation

export type ParseOutcome =
  | { ok: true; query: AnalyticsQuery; metricKeys: string[]; assumptions: string[]; causal: boolean }
  | { ok: false; reason: string; kind: "UNSUPPORTED" | "REFUSED" };

const SQL_LIKE = /(\b(select|insert|update|delete|drop|alter|truncate|union|exec|execute)\b[^.]{0,60}\b(from|into|table|set|database|all)\b)|(;\s*--)|(\/\*)|(\bxp_)/i;
const INJECTION = /(ignore (all |the )?(previous|above|prior)|disregard (all |the )?(previous|above)|system prompt|you are now|reveal your|developer mode|jailbreak|act as)/i;
const PREDICT_PERSON = /(will\b.{0,40}\b(marry|accept|respond|reply|say yes|get married)|likely to (marry|accept|respond)|probability|chance of (marriage|success|accept)|who (should|will|is most likely)|best (applicant|profile|candidate|person)|rank (the )?(applicants|profiles|people|users)|highest[- ]value|predict (who|whether)|which (applicant|person|profile))/i;

const PERIODS: Array<[RegExp, PeriodPreset]> = [
  [/\blast (7|seven) days\b|\bpast week\b|\blast week\b/, "LAST_7_DAYS"],
  [/\blast (30|thirty) days\b|\bpast month\b/, "LAST_30_DAYS"],
  [/\blast (90|ninety) days\b/, "LAST_90_DAYS"],
  [/\b(previous|last) month\b/, "PREVIOUS_MONTH"],
  [/\b(this) month\b|\bmonth to date\b/, "THIS_MONTH"],
  [/\b(previous|last) quarter\b/, "PREVIOUS_QUARTER"],
  [/\bthis quarter\b/, "THIS_QUARTER"],
  [/\b(previous|last) year\b/, "PREVIOUS_YEAR"],
  [/\bthis year\b|\byear to date\b/, "THIS_YEAR"],
  [/\byesterday\b/, "YESTERDAY"],
  [/\btoday\b/, "TODAY"],
];

const DIMENSION_WORDS: Record<string, string[]> = {
  channel: ["channel", "channels"], source: ["source", "sources"], status: ["status", "statuses"], stage: ["stage", "stages", "lifecycle"], priority: ["priority", "priorities"],
  category: ["category", "categories"], type: ["type", "types"], package: ["package", "packages"], department: ["department", "departments", "team", "teams"], method: ["method", "methods"],
  event_type: ["event type"], level: ["level", "severity"], response: ["response type"], record_type: ["record type"], provider: ["provider", "providers"], score_band: ["score band", "score bands", "score distribution"],
  to_stage: ["stage changes", "transitions"], decision: ["decision", "decisions"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();

interface Scored { def: MetricDefinition; score: number; tokens: Set<string> }

const STOP = new Set(["how", "many", "much", "what", "which", "were", "was", "are", "is", "the", "a", "an", "of", "in", "on", "for", "to", "by", "and", "with", "from", "this", "that", "most", "have", "has", "had", "did", "do", "there", "me", "show", "tell", "last", "previous", "month", "year", "week", "quarter", "today", "yesterday", "days", "day", "compare", "compared", "generated"]);
function stem(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}
const tokensOf = (text: string) => new Set(norm(text).split(" ").filter((w) => w && !STOP.has(w)).map(stem));

// A metric matches when one of its names/synonyms appears as a phrase, or when every meaningful word of a multi-word synonym appears
// in the question (in any order). A match whose words are already covered by a stronger match is dropped ("leads" inside "marketing leads").
export function matchMetrics(question: string, candidates: MetricDefinition[] = METRICS): MetricDefinition[] {
  const q = ` ${norm(question)} `;
  const qTokens = tokensOf(question);
  const scored: Scored[] = [];
  for (const def of candidates) {
    let best = 0;
    let bestTokens = new Set<string>();
    for (const phrase of [def.name, ...def.synonyms]) {
      const p = norm(phrase);
      if (p.length < 3) continue;
      const pt = tokensOf(phrase);
      let score = 0;
      if (q.includes(` ${p} `)) score = p.split(" ").length * 10 + p.length;
      else if (pt.size >= 2 && [...pt].every((t) => qTokens.has(t))) score = pt.size * 10 + p.length - 3;
      if (score > best) { best = score; bestTokens = pt; }
    }
    if (best) scored.push({ def, score: best, tokens: bestTokens });
  }
  scored.sort((x, y) => y.score - x.score);
  const kept: Scored[] = [];
  const covered = new Set<string>();
  for (const s of scored) {
    if (kept.length >= 3) break;
    if ([...s.tokens].every((t) => covered.has(t))) continue;
    kept.push(s);
    s.tokens.forEach((t) => covered.add(t));
  }
  return kept.map((k) => k.def);
}

export function parseQuestion(question: string): ParseOutcome {
  const text = (question ?? "").trim();
  if (!text || text.length > 300) return { ok: false, kind: "UNSUPPORTED", reason: "Ask a question of up to 300 characters about the platform's metrics." };
  if (SQL_LIKE.test(text)) return { ok: false, kind: "REFUSED", reason: "I do not run database commands. Ask about a metric instead, for example “How many profiles were verified this month?”" };
  if (INJECTION.test(text)) return { ok: false, kind: "REFUSED", reason: "I can only answer questions about the metrics in the analytics catalog." };
  if (PREDICT_PERSON.test(text)) return { ok: false, kind: "REFUSED", reason: "I do not predict outcomes for people (who will marry, respond or accept) and I do not rank applicants. I can report what has been recorded in aggregate." };

  const lower = norm(text);
  const defs = matchMetrics(text);
  if (!defs.length) return { ok: false, kind: "UNSUPPORTED", reason: "I can't answer that from the available data. Try naming a metric such as new applicants, verified applicants, open cases, proposals, meetings, revenue or marketing leads." };

  const assumptions: string[] = [];
  let preset: PeriodPreset = "LAST_30_DAYS";
  const hit = PERIODS.find(([re]) => re.test(lower));
  if (hit) preset = hit[1];
  else assumptions.push("No period was given, so I used the last 30 days.");

  // a breakdown word ("by channel") counts only if every selected metric supports it
  let dimension: string | undefined;
  const by = /\bby ([a-z ]{3,30})\b/.exec(lower)?.[1] ?? lower;
  for (const [dim, words] of Object.entries(DIMENSION_WORDS)) {
    if (words.some((w) => by.includes(w)) && defs.every((d) => d.dimensions.includes(dim))) { dimension = dim; break; }
  }
  if (!dimension) {
    // if the only thing that matched was a dimensioned metric and the user said "distribution" etc., take its first dimension
    if (/\b(distribution|breakdown|split|by)\b/.test(lower) && defs.length === 1 && defs[0].dimensions.length) dimension = defs[0].dimensions[0];
  }

  const causal = /\b(why|cause|caused|reason|because|what happened|driving|driver)\b/.test(lower);
  const wantsCompare = causal || /\b(compare|compared|versus|vs|change|changed|increase|decrease|increased|decreased|up|down|trend|growth|grew)\b/.test(lower);
  const query: AnalyticsQuery = { metrics: defs.map((d) => d.key), period: { preset }, compare: wantsCompare ? "PREVIOUS_PERIOD" : "NONE", ...(dimension ? { dimension } : {}) };
  return { ok: true, query, metricKeys: query.metrics, assumptions, causal };
}

// ---------------- explanation (deterministic templates; every sentence names its metric, version and period) ----------------
function money(minor: number, currency: string): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const major = `${Math.trunc(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return `${neg ? "-" : ""}${currency || "PKR"} ${major}`;
}
function show(r: MetricResult, v: MetricResult["values"][number]): string {
  if (v.suppressed) return "not shown (group too small to be anonymous)";
  if (v.display === null) return "not available (insufficient verified data)";
  if (r.unit === "MINOR_MONEY") return money(v.display, v.currency);
  if (r.unit === "PERCENT") return `${v.display}%`;
  if (r.unit === "HOURS") return `${v.display} hours`;
  return v.display.toLocaleString("en-US");
}

export interface Explanation { sentences: string[]; citations: Array<{ metric: string; version: string; period: string; source: string }>; limitations: string[] }

export function explainResult(results: MetricResult[], period: string, comparison: string | null, dimension: string, parsed: { assumptions: string[]; causal: boolean }): Explanation {
  const sentences: string[] = [];
  const citations: Explanation["citations"] = [];
  for (const r of results) {
    citations.push({ metric: r.key, version: r.version, period, source: r.definition.source });
    const suffix = r.kind === "SNAPSHOT" ? "as of now" : `for ${period}`;
    if (dimension === "ALL") {
      const parts = r.values.map((v) => (v.currency ? `${show(r, v)}` : show(r, v)));
      sentences.push(`${r.name}: ${parts.join("; ")} (${suffix}).`);
      if (comparison && r.changePct) {
        for (const v of r.values) {
          const c = r.changePct[`${v.dimensionValue}|${v.currency}`];
          sentences.push(c === null || c === undefined ? `Change versus ${comparison}: not available (no comparable non-zero figure).` : `Change versus ${comparison}: ${c > 0 ? "up" : c < 0 ? "down" : "no change"}${c === 0 ? "" : ` ${Math.abs(c)}%`}.`);
        }
      }
    } else {
      const rows = [...r.values].sort((a, b) => (b.display ?? -1) - (a.display ?? -1)).slice(0, 8);
      sentences.push(`${r.name} by ${dimension.replace(/_/g, " ")} (${suffix}): ${rows.map((v) => `${v.dimensionValue.replace(/_/g, " ").toLowerCase()} ${show(r, v)}`).join("; ")}.`);
    }
    if (r.note) sentences.push(`Note on ${r.name}: ${r.note}`);
  }
  const limitations = [
    "Figures come from the analytics catalog; each cites its definition, version, period and source.",
    "This describes recorded activity. It does not predict any outcome for any individual.",
    ...parsed.assumptions,
  ];
  if (parsed.causal) limitations.push("I can show what changed, but I cannot determine why it changed from this data alone.");
  return { sentences, citations, limitations };
}
