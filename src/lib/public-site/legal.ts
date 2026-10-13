// The privacy policy and terms describe how the platform works today. They are not legal advice and have not been reviewed by a lawyer unless the
// owner says so. Two settings keep the pages honest without a code change:
//   LEGAL_PAGES_REVIEWED=true   removes the "pending legal review" notice once counsel has approved the wording.
//   LEGAL_GOVERNING_LAW=<text>  adds a "Governing law" section with the owner's own wording (never invented here).
export const LEGAL_LAST_UPDATED = "13 October 2026";

export function legalPagesReviewed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LEGAL_PAGES_REVIEWED ?? "").toLowerCase() === "true";
}

export function governingLawText(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.LEGAL_GOVERNING_LAW ?? "").trim();
  return v.length > 0 ? v.slice(0, 1000) : null;
}
