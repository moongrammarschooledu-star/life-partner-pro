import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { ConsentCategory, ConsentGrantStatus } from "@prisma/client";

// Spec §3/§4 — the new Consent Center's read/write surface. Additive to (not
// a replacement for) ConsentRecord and CommunicationConsent/
// NotificationPreference, which keep enforcing exactly what they enforce
// today. For the two categories an existing table already owns
// (EMAIL/SMS/WHATSAPP_COMMUNICATION -> CommunicationConsent), granting or
// revoking here also drives that table so real enforcement stays in sync
// with the new history ledger.
const CONSENT_VERSION = "1.0";

const CHANNEL_BACKED_CATEGORIES: Partial<Record<ConsentCategory, "EMAIL" | "SMS" | "WHATSAPP">> = {
  EMAIL_COMMUNICATION: "EMAIL",
  SMS_COMMUNICATION: "SMS",
  WHATSAPP_COMMUNICATION: "WHATSAPP",
};

export async function recordConsent(params: {
  profileId: string;
  category: ConsentCategory;
  status: ConsentGrantStatus;
  source: string;
  ipHash?: string | null;
}) {
  const grant = await prisma.consentGrant.create({
    data: {
      profileId: params.profileId,
      category: params.category,
      status: params.status,
      version: CONSENT_VERSION,
      source: params.source,
      ipHash: params.ipHash ?? null,
    },
  });

  const channel = CHANNEL_BACKED_CATEGORIES[params.category];
  if (channel) {
    await prisma.communicationConsent.upsert({
      where: { profileId_channel: { profileId: params.profileId, channel } },
      update: {
        status: params.status,
        revokedAt: params.status === "REVOKED" ? new Date() : null,
        ...(params.status === "GRANTED" ? { consentedAt: new Date() } : {}),
      },
      create: { profileId: params.profileId, channel, status: params.status, consentSource: params.source },
    });
  }

  await writeAudit({
    action: params.status === "GRANTED" ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
    targetProfileId: params.profileId,
    meta: { category: params.category, grantId: grant.id },
  });

  return grant;
}

export async function revokeConsent(profileId: string, category: ConsentCategory, source: string) {
  return recordConsent({ profileId, category, status: "REVOKED", source });
}

export async function getConsentHistory(profileId: string) {
  return prisma.consentGrant.findMany({ where: { profileId }, orderBy: { recordedAt: "desc" } });
}

// Latest row per category — the current effective grant/revoke state.
export async function resolveEffectiveConsent(profileId: string): Promise<Record<string, ConsentGrantStatus>> {
  const history = await getConsentHistory(profileId);
  const effective: Record<string, ConsentGrantStatus> = {};
  for (const row of history) {
    if (!(row.category in effective)) effective[row.category] = row.status;
  }
  return effective;
}
