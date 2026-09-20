import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { verifyStepUpToken } from "@/lib/step-up-token";

// Shared guards for the STEP 15 admin routes (spec §48/§58): high-risk actions
// need a fresh password re-confirmation (same primitive as refund execution
// and the payment kill switch) and a written reason that lands in the audit.

export function requireReauth(admin: SessionAdmin, stepUpToken: string | undefined, what: string): void {
  if (!verifyStepUpToken(stepUpToken, "REAUTH", admin.id)) {
    throw new ApiError(403, `Please re-enter your password to ${what}.`);
  }
}

export function requireReason(reason: unknown, min = 5): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < min) throw new ApiError(400, `A reason (at least ${min} characters) is required.`);
  return text.slice(0, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid request body.");
  }
}
