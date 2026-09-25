import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { acceptInvitation, FamilyInvitationError } from "@/lib/family/invitation";
import { createFamilyMemberSession } from "@/lib/family/family-member-session";
import { signFamilySessionId, FAMILY_SESSION_ID_COOKIE } from "@/lib/family/family-session";

// Public, token-gated (spec §5) — this is the invitation-acceptance
// endpoint itself, so it cannot require a family session to already exist.
// Rate-limited against token brute-forcing; the token is a high-entropy
// random value hashed with bcrypt before storage (src/lib/family/invitation.ts).
export async function POST(req: Request) {
  const key = `family-register:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  try {
    const { invitationCode, token, password } = await req.json();
    if (typeof invitationCode !== "string" || typeof token !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const { familyMemberId } = await acceptInvitation({ invitationCode, token, password });

    const session = await createFamilyMemberSession(familyMemberId, undefined, req.headers.get("user-agent") ?? undefined, clientKeyFromRequest(req));
    const cookieStore = await cookies();
    cookieStore.set(FAMILY_SESSION_ID_COOKIE, signFamilySessionId(session.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyInvitationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
