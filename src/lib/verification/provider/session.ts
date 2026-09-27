import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getVerificationProvider, isIdentityVerificationEnabled, VerificationProviderNotConfiguredError } from "./index";
import type { VerificationSession } from "./types";

export class ProviderSessionError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// Starts a provider-backed identity verification session for a profile and
// records the session reference on its ProfileVerification row (additive
// columns — see the STEP 23 plan's decision 6). Never itself changes
// VerificationStatus — that only ever happens via the webhook (toward a
// review state) or an admin's own verification:approve/reject action.
export async function createProviderSession(profileId: string, documentType: string, country: string): Promise<VerificationSession> {
  if (!isIdentityVerificationEnabled()) {
    throw new ProviderSessionError(503, "Identity verification is temporarily unavailable. Please try again later.");
  }

  const provider = getVerificationProvider();
  let session: VerificationSession;
  try {
    session = await provider.createSession({ profileId, documentType, country });
  } catch (error) {
    if (error instanceof VerificationProviderNotConfiguredError) {
      throw new ProviderSessionError(503, "Identity verification is temporarily unavailable. Please try again later.");
    }
    throw error;
  }

  await prisma.profileVerification.upsert({
    where: { profileId },
    update: { providerName: provider.name, providerSessionId: session.sessionId, providerReference: session.providerReference, providerStatus: "PENDING" },
    create: { profileId, providerName: provider.name, providerSessionId: session.sessionId, providerReference: session.providerReference, providerStatus: "PENDING" },
  });

  await writeAudit({ action: "PROVIDER_SESSION_CREATED", targetProfileId: profileId, meta: { provider: provider.name, documentType, country } });

  return session;
}
