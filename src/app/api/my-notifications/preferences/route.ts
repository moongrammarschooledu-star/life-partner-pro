import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { writeAudit } from "@/lib/audit";
import type { NotificationChannel } from "@prisma/client";

const PREFERENCE_FIELDS = [
  "inAppProposalUpdates", "inAppMeetingUpdates", "inAppFollowUpReminders", "inAppMarketing",
  "emailProposalUpdates", "emailMeetingUpdates", "emailFollowUpReminders", "emailMarketing",
  "smsProposalUpdates", "smsMeetingUpdates", "smsFollowUpReminders", "smsMarketing",
  "whatsappProposalUpdates", "whatsappMeetingUpdates", "whatsappFollowUpReminders", "whatsappMarketing",
] as const;

const CONSENT_CHANNELS: NotificationChannel[] = ["EMAIL", "SMS", "WHATSAPP"];

async function getProfileId() {
  const cookieStore = await cookies();
  return verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
}

export async function GET() {
  const profileId = await getProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [preference, consents, profile] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { profileId } }),
    prisma.communicationConsent.findMany({ where: { profileId } }),
    prisma.profile.findUnique({ where: { id: profileId }, select: { preferredLanguage: true } }),
  ]);

  const consentByChannel = Object.fromEntries(CONSENT_CHANNELS.map((c) => [c, consents.find((row) => row.channel === c)?.status ?? "GRANTED"]));

  return NextResponse.json({ preferences: preference, consent: consentByChannel, preferredLanguage: profile?.preferredLanguage ?? "EN" });
}

export async function PATCH(req: Request) {
  const profileId = await getProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json();
  const { preferences, consent, preferredLanguage } = body as {
    preferences?: Partial<Record<(typeof PREFERENCE_FIELDS)[number], boolean>>;
    consent?: { channel: NotificationChannel; status: "GRANTED" | "REVOKED" }[];
    preferredLanguage?: "EN" | "UR";
  };

  if (preferredLanguage === "EN" || preferredLanguage === "UR") {
    await prisma.profile.update({ where: { id: profileId }, data: { preferredLanguage } });
  }

  if (preferences) {
    const data: Record<string, boolean> = {};
    for (const field of PREFERENCE_FIELDS) {
      if (typeof preferences[field] === "boolean") data[field] = preferences[field]!;
    }
    await prisma.notificationPreference.upsert({
      where: { profileId },
      update: data,
      create: { profileId, ...data },
    });
    await writeAudit({ action: "NOTIFICATION_PREFERENCE_CHANGED", targetProfileId: profileId, meta: data });
  }

  if (Array.isArray(consent)) {
    for (const entry of consent) {
      if (!CONSENT_CHANNELS.includes(entry.channel)) continue;
      const status = entry.status === "REVOKED" ? "REVOKED" : "GRANTED";
      await prisma.communicationConsent.upsert({
        where: { profileId_channel: { profileId, channel: entry.channel } },
        update: { status, revokedAt: status === "REVOKED" ? new Date() : null, ...(status === "GRANTED" ? { consentedAt: new Date() } : {}) },
        create: { profileId, channel: entry.channel, status, consentSource: "notification_settings_page" },
      });
      await writeAudit({ action: "COMMUNICATION_CONSENT_CHANGED", targetProfileId: profileId, meta: { channel: entry.channel, status } });
    }
  }

  return NextResponse.json({ ok: true });
}
