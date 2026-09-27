import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { setVerificationStatus } from "@/lib/verification/status";
import { createFromEvent } from "@/lib/workflow/engine";

// Spec §25/§26 — only these identity-adjacent fields ever trigger
// reverification; ordinary edits (city, hobbies, preferences, etc.) never do
// ("do not automatically trigger unnecessary KYC for ordinary harmless
// edits"). Called from both the admin edit route and the applicant
// self-service profile update route after a successful save.
const IDENTITY_FIELDS = ["fullName", "dateOfBirth", "mobileNumber", "email"] as const;

export async function checkAndTriggerReverification(profileId: string, changedFields: readonly string[]): Promise<void> {
  const touchesIdentityField = changedFields.some((f) => (IDENTITY_FIELDS as readonly string[]).includes(f));
  if (!touchesIdentityField) return;

  const verification = await prisma.profileVerification.findUnique({ where: { profileId } });
  // Only a currently-VERIFIED profile needs to be pulled back for review —
  // editing an identity field before you were ever verified is just normal
  // registration/correction, not a reverification event.
  if (!verification || verification.status !== "VERIFIED") return;

  await setVerificationStatus(profileId, "RE_VERIFICATION_REQUIRED", {
    reVerificationReason: `Identity-related field changed: ${changedFields.join(", ")}`,
  });

  await writeAudit({ action: "REVERIFICATION_TRIGGERED", targetProfileId: profileId, meta: { changedFields } });

  await createFromEvent({
    eventName: "REVERIFICATION_TRIGGERED",
    dedupKey: `REVERIFICATION_REVIEW:${profileId}:${verification.verificationVersion}`,
    resourceType: "PROFILE",
    resourceId: profileId,
    taskType: "VERIFICATION_REVIEW",
    title: "Re-verification required — identity field changed",
    description: `Changed fields: ${changedFields.join(", ")}`,
  });
}
