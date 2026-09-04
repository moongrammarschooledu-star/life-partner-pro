import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";

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
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return null;
  return prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true, preference: true } });
}

export async function POST(req: Request) {
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
        contact: {
          mobileNumber: profile.contact!.mobileNumber,
          whatsappNumber: profile.contact!.whatsappNumber,
          email: profile.contact!.email,
        },
        preference: profile.preference,
      });
    }

    if (action === "submit") {
      const { contact, preference } = body;
      await prisma.pendingUpdate.upsert({
        where: { profileId: profile.id },
        update: { payload: JSON.stringify({ contact, preference }), submittedAt: new Date() },
        create: { profileId: profile.id, payload: JSON.stringify({ contact, preference }) },
      });

      await writeAudit({ action: "UPDATE_REQUEST_SUBMITTED", targetProfileId: profile.id });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
