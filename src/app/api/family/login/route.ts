import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { createFamilyMemberSession } from "@/lib/family/family-member-session";
import { signFamilySessionId, FAMILY_SESSION_ID_COOKIE } from "@/lib/family/family-session";

// Public (this IS the login flow) — password-based per Decision 2. Never
// distinguishes "no such email" from "wrong password" in its error message
// (enumeration guard), and never reveals whether a suspended/revoked account
// exists either.
export async function POST(req: Request) {
  const key = `family-login:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const { email, password } = await req.json();
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const member = await prisma.familyMember.findFirst({ where: { email: email.trim().toLowerCase() } });
  const genericError = () => NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  if (!member) {
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva"); // constant-time-ish decoy hash
    return genericError();
  }

  const valid = await bcrypt.compare(password, member.passwordHash);
  if (!valid) {
    await writeAudit({ action: "FAMILY_LOGIN_FAILED", actorFamilyMemberId: member.id, meta: { reason: "bad_password" } });
    return genericError();
  }
  if (member.status !== "ACTIVE") {
    await writeAudit({ action: "FAMILY_LOGIN_FAILED", actorFamilyMemberId: member.id, meta: { reason: "not_active", status: member.status } });
    return genericError();
  }

  const session = await createFamilyMemberSession(member.id, undefined, req.headers.get("user-agent") ?? undefined, clientKeyFromRequest(req));
  const cookieStore = await cookies();
  cookieStore.set(FAMILY_SESSION_ID_COOKIE, signFamilySessionId(session.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  await prisma.familyMember.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({ action: "FAMILY_MEMBER_LOGIN", actorFamilyMemberId: member.id });

  return NextResponse.json({ ok: true });
}
