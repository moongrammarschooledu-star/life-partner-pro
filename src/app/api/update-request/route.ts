import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { notifyAdminProfileUpdatePending } from "@/lib/notifications/events";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { blockedResponse } from "@/lib/ops/guards";

// Lightweight self-service verification: matching Profile Code + email is
// enough to look up and submit an update request. This is intentionally not
// a full account system (the spec doesn't call for one) — every submitted
// change still requires admin approval before it takes effect (spec §21).
async function findProfileByCodeAndEmail(profileCode: string, email: string) {
  const profile = await prisma.profile.findUnique({
    where: { profileCode },
    include: { contact: true, preference: true },
  });
  if (!profile || !profile.contact || profile.contact.email.toLowerCase() !== email.toLowerCase()) {
    return null;
  }
  return profile;
}

async function findProfileBySessionCookie() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return null;
  return prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true, preference: true } });
}

export async function POST(req: Request) {
  const blocked = await blockedResponse({ switches: ["profileSubmissions"] });
  if (blocked) return blocked;
  const key = `update-request:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { profileCode, email, action } = body;

    // A visitor arriving from /my-status is already proven to own this
    // profile via the signed session cookie — no need to re-enter email.
    const profile =
      (await findProfileBySessionCookie()) ??
      (typeof profileCode === "string" && typeof email === "string"
        ? await findProfileByCodeAndEmail(profileCode.trim().toUpperCase(), email.trim())
        : null);

    if (!profile) {
      return NextResponse.json({ error: "We could not find a profile matching that Profile ID and email." }, { status: 404 });
    }

    if (action === "lookup") {
      return NextResponse.json({
        profileCode: profile.profileCode,
        contact: {
          mobileNumber: profile.contact!.mobileNumber,
          whatsappNumber: profile.contact!.whatsappNumber,
          email: profile.contact!.email,
        },
        preference: profile.preference,
      });
    }

    if (action === "submit") {
      // Spec §18 — real backend enforcement, not a hidden button.
      if (await hasActiveRestriction(profile.id, "CANNOT_UPDATE_FIELDS")) {
        return NextResponse.json({ error: "This profile is currently restricted from submitting update requests." }, { status: 403 });
      }
      // STEP 13 spec §23 — extended beyond contact/preference to cover
      // name/DOB/education/profession/family corrections. A resubmission
      // MERGES field groups into any existing pending payload (shallow, by
      // top-level key) rather than replacing it wholesale, so a name
      // correction no longer silently discards an already-pending contact
      // correction.
      const { contact, preference, personal, education, profession, family } = body;
      const incoming = { contact, preference, personal, education, profession, family };
      const existing = await prisma.pendingUpdate.findUnique({ where: { profileId: profile.id } });
      const existingPayload = existing ? JSON.parse(existing.payload) : {};
      const merged = { ...existingPayload };
      for (const [key, value] of Object.entries(incoming)) {
        if (value !== undefined) merged[key] = value;
      }

      await prisma.pendingUpdate.upsert({
        where: { profileId: profile.id },
        update: { payload: JSON.stringify(merged), submittedAt: new Date() },
        create: { profileId: profile.id, payload: JSON.stringify(merged) },
      });

      await writeAudit({ action: "UPDATE_REQUEST_SUBMITTED", targetProfileId: profile.id, meta: { fieldGroups: Object.keys(incoming).filter((k) => incoming[k as keyof typeof incoming] !== undefined) } });
      await notifyAdminProfileUpdatePending(profile.id);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
