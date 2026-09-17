import { prisma } from "@/lib/prisma";
import { recordConsent } from "@/lib/privacy/consent";
import type { ConsentCategory } from "@prisma/client";

// One-time seed for historical profiles (spec §3) — creates the first
// ConsentGrant history rows for a profile that predates STEP 13, reflecting
// its CURRENT ConsentRecord/CommunicationConsent state. Idempotent: skips a
// category if a ConsentGrant already exists for it (never duplicates
// history on repeated runs).
const IMPLICIT_GRANTED_CATEGORIES: ConsentCategory[] = [
  "PROFILE_MATCHING",
  "PROPOSAL_PARTICIPATION",
  "CONTACT_SHARING",
  "PHOTO_PROCESSING",
  "VERIFICATION_PROCESSING",
  "AI_ASSISTED_MATCHING",
  "ANALYTICS",
  "DATA_RETENTION",
  "NOTIFICATIONS",
];

export async function backfillConsentGrantsForProfile(profileId: string) {
  const existing = await prisma.consentGrant.findMany({ where: { profileId }, select: { category: true } });
  const already = new Set(existing.map((e) => e.category));

  const [consentRecord, communicationConsents] = await Promise.all([
    prisma.consentRecord.findUnique({ where: { profileId } }),
    prisma.communicationConsent.findMany({ where: { profileId } }),
  ]);

  const tasks: Promise<unknown>[] = [];

  if (consentRecord) {
    if (!already.has("MATRIMONIAL_PROFILE_PROCESSING")) {
      tasks.push(recordConsent({ profileId, category: "MATRIMONIAL_PROFILE_PROCESSING", status: consentRecord.matchmakingConsent ? "GRANTED" : "REVOKED", source: "BACKFILL" }));
    }
    if (!already.has("ACCOUNT_CREATION")) {
      tasks.push(recordConsent({ profileId, category: "ACCOUNT_CREATION", status: consentRecord.privacyConsent ? "GRANTED" : "REVOKED", source: "BACKFILL" }));
    }
    if (!already.has("TERMS_AND_PRIVACY_POLICY")) {
      tasks.push(recordConsent({ profileId, category: "TERMS_AND_PRIVACY_POLICY", status: consentRecord.termsAccepted ? "GRANTED" : "REVOKED", source: "BACKFILL" }));
    }
  }

  const emailConsent = communicationConsents.find((c) => c.channel === "EMAIL");
  const smsConsent = communicationConsents.find((c) => c.channel === "SMS");
  const whatsappConsent = communicationConsents.find((c) => c.channel === "WHATSAPP");
  if (!already.has("EMAIL_COMMUNICATION")) {
    tasks.push(recordConsent({ profileId, category: "EMAIL_COMMUNICATION", status: emailConsent?.status ?? "GRANTED", source: "BACKFILL" }));
  }
  if (!already.has("SMS_COMMUNICATION")) {
    tasks.push(recordConsent({ profileId, category: "SMS_COMMUNICATION", status: smsConsent?.status ?? "GRANTED", source: "BACKFILL" }));
  }
  if (!already.has("WHATSAPP_COMMUNICATION")) {
    tasks.push(recordConsent({ profileId, category: "WHATSAPP_COMMUNICATION", status: whatsappConsent?.status ?? "GRANTED", source: "BACKFILL" }));
  }

  for (const category of IMPLICIT_GRANTED_CATEGORIES) {
    if (!already.has(category)) {
      tasks.push(recordConsent({ profileId, category, status: "GRANTED", source: "BACKFILL" }));
    }
  }

  await Promise.all(tasks);
}
