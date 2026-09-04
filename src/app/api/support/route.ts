import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const key = `support:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

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
