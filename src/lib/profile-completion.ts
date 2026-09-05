// Profile-completion scoring for the registration wizard's live Review-step
// preview only (fields as controlled-input strings, instant per-keystroke
// feedback on partial, unpersisted form state). All the fields checked here
// are optional in the Zod schema — this never blocks submission, it only
// informs a percentage + suggestions (spec §14).
//
// This is deliberately NOT the same calculator used for the canonical,
// persisted Profile.profileCompletion value post-registration — see
// src/lib/verification/completeness.ts (STEP 8's category-weighted model,
// which operates on a fully loaded Profile + relations). Keeping them
// separate avoids coupling an in-progress form's instant feedback to a
// heavier, relation-loading calculation.

export interface CompletionInput {
  hasPhoto: boolean;
  area?: string;
  nationality?: string;
  degree?: string;
  institution?: string;
  familyBackground?: string;
  aboutMe?: string;
  hobbies?: string;
  personality?: string;
  religion?: string;
}

const BONUS_FIELDS: { key: keyof CompletionInput; weight: number; suggestion: string }[] = [
  { key: "hasPhoto" as const, weight: 15, suggestion: "Add a profile photo to complete your profile." },
  { key: "degree", weight: 8, suggestion: "Add your degree and institution to strengthen your profile." },
  { key: "familyBackground", weight: 8, suggestion: "Describe your family background for better matches." },
  { key: "aboutMe", weight: 10, suggestion: "Tell us about yourself in the About Me section." },
  { key: "hobbies", weight: 6, suggestion: "Add a few hobbies or interests." },
  { key: "personality", weight: 6, suggestion: "Select a few personality traits." },
  { key: "religion", weight: 6, suggestion: "Add your religious preference if you'd like it considered in matching." },
  { key: "area", weight: 5, suggestion: "Add your area for more precise location matching." },
  { key: "nationality", weight: 4, suggestion: "Add your nationality." },
];

const BASELINE = 32; // required fields already enforced by Zod cover the rest of the required-info baseline

export function computeCompletion(input: CompletionInput): { percent: number; suggestions: string[] } {
  let points = BASELINE;
  const suggestions: string[] = [];

  for (const field of BONUS_FIELDS) {
    const value = input[field.key];
    const filled = field.key === "hasPhoto" ? value === true : typeof value === "string" && value.trim().length > 0;
    if (filled) {
      points += field.weight;
    } else {
      suggestions.push(field.suggestion);
    }
  }

  const percent = Math.max(0, Math.min(100, Math.round(points)));
  return { percent, suggestions: suggestions.slice(0, 3) };
}
