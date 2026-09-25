import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { verifyFamilySessionIdToken, FAMILY_SESSION_ID_COOKIE } from "@/lib/family/family-session";
import { touchAndValidateFamilyMemberSession, revokeFamilyMemberSession } from "@/lib/family/family-member-session";

export async function POST(req: Request) {
  const key = `family-logout:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  const cookieStore = await cookies();
  const sessionId = verifyFamilySessionIdToken(cookieStore.get(FAMILY_SESSION_ID_COOKIE)?.value);
  if (sessionId) {
    const familyMemberId = await touchAndValidateFamilyMemberSession(sessionId);
    if (familyMemberId) await revokeFamilyMemberSession(sessionId, familyMemberId);
  }
  cookieStore.delete(FAMILY_SESSION_ID_COOKIE);
  return NextResponse.json({ ok: true });
}
