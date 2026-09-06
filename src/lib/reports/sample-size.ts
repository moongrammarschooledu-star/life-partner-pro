// Spec §14/§34 — never compute a misleading rate on too small a sample.
// Extends the dashboard's existing trendPercent() null-safety convention
// (return null, not a fabricated 0%/100%, when there's no clean basis) to
// every rate/percentage calculation in Reports & Analytics.
export const MIN_SAMPLE_SIZE = 5;

// Pure. Returns a rounded percentage (0-100) or null when the denominator is
// below MIN_SAMPLE_SIZE (including zero) — callers render "Not enough data
// available for this report" instead of the number in that case.
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator < MIN_SAMPLE_SIZE) return null;
  return Math.round((numerator / denominator) * 100);
}
