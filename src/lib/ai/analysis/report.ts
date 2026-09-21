import type { AiPayload } from "@/lib/ai/types";

// Spec §46/§47 — report summaries. The narrative is assembled ONLY from the
// numbers passed in (which come from the existing Step 10 aggregate
// functions). Nothing is estimated, extrapolated or invented, and every number
// is shown with its source.

export interface ReportFigure {
  label: string;
  value: number;
  unit?: string;
}

export function buildReportSummary(params: { title: string; periodDays: number; figures: ReportFigure[]; generatedAt: Date }): AiPayload {
  const { figures } = params;
  const evidence = figures.map((f) => ({
    label: f.label,
    value: `${f.value}${f.unit ? ` ${f.unit}` : ""}`,
    source: "DATABASE" as const,
  }));
  const narrative = figures.length
    ? `${params.title} — last ${params.periodDays} days: ` + figures.map((f) => `${f.label} ${f.value}${f.unit ? ` ${f.unit}` : ""}`).join("; ") + "."
    : `${params.title}: no data was returned for this period.`;
  return {
    summary: narrative.slice(0, 1900),
    evidence,
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: figures.length ? [] : ["No figures were available for the selected period."],
    verificationQuestions: [],
    suggestedNextStep: null,
    limitations: [
      "Figures are read directly from the Life Partner Pro database at the time shown; this text only restates them.",
      "No trend, forecast or cause is inferred. Consult the full report for detail.",
    ],
    sufficiency: figures.length ? "SUFFICIENT" : "LIMITED",
    data: { source: "Life Partner Pro database", generatedAt: params.generatedAt.toISOString(), periodDays: params.periodDays },
  };
}
