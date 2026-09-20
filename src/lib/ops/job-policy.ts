import type { JobStatus } from "@prisma/client";

// Pure retry policy for the background job queue (spec §29). Exponential
// backoff (5 min, 10, 20, …) capped at 6 h; a job that exhausts its attempts
// goes to DEAD_LETTER for manual review instead of retrying forever.

export function backoffMs(attempts: number): number {
  const base = 5 * 60_000;
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

export function nextStatusAfterFailure(attempts: number, maxAttempts: number): { status: JobStatus; delayMs: number | null } {
  if (attempts >= maxAttempts) return { status: "DEAD_LETTER", delayMs: null };
  return { status: "RETRYING", delayMs: backoffMs(attempts) };
}

const MANUAL_RETRY_FROM: JobStatus[] = ["FAILED", "DEAD_LETTER"];
const CANCEL_FROM: JobStatus[] = ["PENDING", "RETRYING", "FAILED"];

export function canRetry(status: JobStatus): boolean {
  return MANUAL_RETRY_FROM.includes(status);
}
export function canCancel(status: JobStatus): boolean {
  return CANCEL_FROM.includes(status);
}
