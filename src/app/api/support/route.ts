import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { blockedResponse } from "@/lib/ops/guards";

export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["support.enabled"] });
  if (blocked) return blocked;
  const limited = await enforceConfiguredLimit(req, "support", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const { profileCode, email, subject, message } = await req.json();

    if (!email || !subject || !message) {
      return NextResponse.json({ error: "Email, subject, and message are required." }, { status: 400 });
    }

    await prisma.supportMessage.create({
      data: {
        profileCode: profileCode || null,
        email,
        subject,
        message,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
