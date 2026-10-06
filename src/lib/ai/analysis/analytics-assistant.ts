import type { AiPayload, Evidence } from "@/lib/ai/types";
import type { Explanation } from "@/lib/analytics/assistant";

// STEP 31 — turns an already-computed analytics answer into the standard AI result layout. PURE: it imports no database, messaging,
// approval, finance or provider code (a structure test enforces that) and it adds no figures of its own — every number in it came from
// the structured-query engine after the viewer's permissions were checked. It cannot execute a query, send anything or predict anything.

export const ANALYTICS_AI_REVIEW_LABEL = "AI-Assisted Answer — figures come from the analytics catalog";

export function buildAnalyticsAnswer(input: { question: string; refused?: string; unsupported?: string; denied?: string; explanation?: Explanation; period?: string; freshness?: string }): AiPayload {
  const evidence: Evidence[] = [];
  const add = (label: string, value: string | undefined | null) => { if (value) evidence.push({ label: label.slice(0, 80), value: value.slice(0, 300), source: "DATABASE" }); };
  add("Question", input.question.slice(0, 200));

  if (input.refused || input.unsupported || input.denied) {
    const message = input.refused ?? input.unsupported ?? input.denied ?? "";
    return {
      summary: message.slice(0, 1990), evidence, alignedAreas: [], potentialConflicts: [], missingInformation: input.unsupported ? ["A metric in the analytics catalog that matches the question"] : [], verificationQuestions: [],
      suggestedNextStep: input.denied ? "Ask an administrator for access to that analytics section." : "Rephrase the question around a specific metric and period.",
      limitations: [ANALYTICS_AI_REVIEW_LABEL, "No query was run for this question."], sufficiency: "LIMITED",
      data: { answered: false, reviewLabel: ANALYTICS_AI_REVIEW_LABEL },
    };
  }

  const e = input.explanation as Explanation;
  add("Period", input.period);
  add("Data freshness", input.freshness);
  for (const c of e.citations.slice(0, 12)) add(`Metric ${c.metric}`, `version ${c.version} · ${c.period} · source ${c.source}`);
  return {
    summary: e.sentences.join(" ").slice(0, 1990), evidence: evidence.slice(0, 60), alignedAreas: [], potentialConflicts: [], missingInformation: [], verificationQuestions: [],
    suggestedNextStep: "Open the metric catalog to read the full definition, or build a report from this question.",
    limitations: [ANALYTICS_AI_REVIEW_LABEL, ...e.limitations].map((l) => l.slice(0, 290)).slice(0, 18),
    sufficiency: "SUFFICIENT", data: { answered: true, citations: e.citations, reviewLabel: ANALYTICS_AI_REVIEW_LABEL },
  };
}

// ---- executive summary: observed facts, calculations, rule-based interpretations and recommendations, each labelled ----
export interface SummaryFact { section: string; kind: "OBSERVED" | "CALCULATED" | "INTERPRETATION" | "RECOMMENDATION"; text: string; metric?: string }

export function buildExecutiveSummaryPayload(input: { period: string; comparison: string | null; freshness: string; facts: SummaryFact[]; limitations: string[] }): AiPayload {
  const evidence: Evidence[] = [];
  const add = (label: string, value: string) => evidence.push({ label: label.slice(0, 80), value: value.slice(0, 300), source: "DATABASE" });
  add("Period", input.period || "not available");
  if (input.comparison) add("Compared with", input.comparison);
  if (input.freshness) add("Data freshness", input.freshness);
  const label = { OBSERVED: "Observed", CALCULATED: "Calculated", INTERPRETATION: "Interpretation", RECOMMENDATION: "Recommendation" } as const;
  for (const f of input.facts.filter((x) => x.kind === "OBSERVED" || x.kind === "CALCULATED").slice(0, 40)) add(`${label[f.kind]} — ${f.section}`, f.text);
  const interpretations = input.facts.filter((f) => f.kind === "INTERPRETATION").map((f) => `Interpretation: ${f.text}`);
  const recommendations = input.facts.filter((f) => f.kind === "RECOMMENDATION").map((f) => `Recommendation: ${f.text}`);
  const headline = input.facts.length ? `Summary for ${input.period}: ${input.facts.filter((f) => f.kind === "OBSERVED" || f.kind === "CALCULATED").length} figures recorded, ${interpretations.length} point(s) that may need attention.` : "Insufficient verified data for a summary of this period.";
  return {
    summary: headline.slice(0, 1990), evidence: evidence.slice(0, 60), alignedAreas: [], potentialConflicts: interpretations.map((x) => x.slice(0, 290)).slice(0, 40),
    missingInformation: input.facts.length ? [] : ["Recorded activity for the chosen period"], verificationQuestions: [],
    suggestedNextStep: recommendations[0]?.slice(0, 290) ?? null,
    limitations: [ANALYTICS_AI_REVIEW_LABEL, "Observed and calculated lines are figures from the catalog; interpretations come from simple fixed rules and are not conclusions.", ...input.limitations].map((l) => l.slice(0, 290)).slice(0, 18),
    sufficiency: input.facts.length ? "SUFFICIENT" : "LIMITED",
    data: { answered: input.facts.length > 0, kinds: ["OBSERVED", "CALCULATED", "INTERPRETATION", "RECOMMENDATION"], recommendations, reviewLabel: ANALYTICS_AI_REVIEW_LABEL },
  };
}
