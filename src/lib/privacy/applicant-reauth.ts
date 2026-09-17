import { issueStepUpToken, verifyStepUpToken } from "@/lib/step-up-token";

// Spec §22/§14 — identity reconfirmation before a high-risk applicant
// action (deactivate/delete/export), reusing the existing OTP infrastructure
// (src/lib/verification/otp-service.ts) for the challenge and the existing
// step-up-token primitive (already used for admin 2FA/reauth) for the
// resulting short-lived proof — no new crypto.
const REAUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function issueApplicantReauthToken(profileId: string): string {
  return issueStepUpToken("applicant-reauth", profileId, REAUTH_TTL_MS);
}

export function verifyApplicantReauthToken(token: string | null | undefined, profileId: string): boolean {
  return verifyStepUpToken(token, "applicant-reauth", profileId);
}
