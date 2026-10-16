import { shareableSections, type PdfSection, type ProfileDetailView } from "@/lib/profile-pdf";

// The comparison of a best match as a sheet that can be handed to ONE of the two people: how the two compare, side by side, and why they were matched. It is written for a
// recipient ("You" / "Candidate"). It carries both names (the owner decided names may go) and the safe summary (shareableSections: no area, no income, no family details) for
// both sides, and leaves out the income comparison and the per-direction scores. Never a photo and never any contact detail.

export type ComparisonStatus = "compatible" | "partial" | "incompatible" | "unknown";

export interface ComparisonRow {
  category: string;
  label: string;
  score: number; // 0..1
  status: ComparisonStatus;
  reason: string;
}

const safeRows = (p: ProfileDetailView): Array<[string, string]> => shareableSections(p)[0]?.rows ?? [];

export function comparisonSections(input: { you: ProfileDetailView; other: ProfileDetailView; total: number; tierLabel: string; breakdown: ComparisonRow[] }): PdfSection[] {
  const yours = new Map(safeRows(input.you));
  const theirs = new Map(safeRows(input.other));
  const labels = [...new Set([...yours.keys(), ...theirs.keys()])];

  const compatibility: Array<[string, string]> = [["Overall", `${Math.round(input.total)}% - ${input.tierLabel}`]];
  for (const row of input.breakdown) {
    if (row.category === "income") continue; // a comparison of incomes is not for the other side
    compatibility.push([row.label, row.status === "unknown" ? row.reason : `${Math.round(row.score * 100)}% - ${row.reason}`]);
  }

  return [
    { title: "How well you match", rows: compatibility },
    {
      title: "Side by side",
      rows: [
        ["Name", `You: ${input.you.fullName}\nCandidate: ${input.other.fullName}`] as [string, string],
        ...labels.map((label): [string, string] => [label, `You: ${yours.get(label) ?? "-"}\nCandidate: ${theirs.get(label) ?? "-"}`]),
      ],
    },
  ].filter((s) => s.rows.length > 0);
}
