import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";

// Small shared helper for the STEP 12 /api/my-cases/* routes — every other
// /api/my-* route repeats this cookie-verify + not-soft-deleted check inline
// (see /api/my-proposals/route.ts); factored out here since STEP 12 adds
// several new routes needing the identical check.
export async function requireApplicantProfileId(): Promise<string | null> {
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return null;

  const me = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
  if (!me || me.softDeleted) return null;

  return profileId;
}
