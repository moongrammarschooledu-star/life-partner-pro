import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getVerificationProvider, isIdentityVerificationEnabled, VerificationProviderNotConfiguredError } from "./index";
import { assessTransfer } from "@/lib/compliance/transfer";
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

  // STEP 23 Add-on §19 — a verification provider is exactly "sending
  // sensitive data to a third country." Best-effort, non-blocking: never
  // lets an assessment failure or an unresolved jurisdiction stop a working
  // verification flow. assessTransfer() itself always persists a record
  // (UNKNOWN/REVIEW_REQUIRED, never a silent ALLOWED, when it can't resolve
  // both sides of the transfer) for later compliance review.
  await assessCrossBorderTransferForProvider(profileId, provider.name, country).catch(() => undefined);

  return session;
}

async function assessCrossBorderTransferForProvider(profileId: string, providerName: string, applicantCountry: string): Promise<void> {
  const now = new Date();
  const [sourceJurisdiction, processor] = await Promise.all([
    prisma.jurisdiction.findFirst({
      where: { countryCode: applicantCountry, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    }),
    prisma.complianceProcessor.findFirst({ where: { serviceType: "IDENTITY_VERIFICATION", name: providerName } }),
  ]);

  await assessTransfer({
    sourceJurisdictionId: sourceJurisdiction?.id,
    destJurisdictionCode: processor?.country,
    dataClass: "HIGHLY_SENSITIVE",
    dataType: "identity_document",
    purpose: "IDENTITY_VERIFICATION",
    provider: providerName,
  });
}
