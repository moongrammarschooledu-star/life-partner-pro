import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { blockedResponse } from "@/lib/ops/guards";
import { contactSchema } from "@/lib/public-site/contact";
import { isSameOrigin } from "@/lib/marketing/origin";

// Public contact / support form. Protected by the support.enabled flag, a same-origin check, a per-client rate limit, a 16 KB body cap, server-side validation
// (the same schema the form uses), a honeypot field, a consent requirement and a duplicate guard. Nothing is echoed back.
const MAX_BODY_BYTES = 16 * 1024;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["support.enabled"] });
  if (blocked) return blocked;
  // A browser sends Origin on a form POST; a request from another site (or a bare script) is refused before anything is read.
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const limited = await enforceConfiguredLimit(req, "support", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Your message is too long." }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    // A filled honeypot is acknowledged exactly like success, so a bot learns nothing and retries nothing.
    if (typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).website === "string" && (json as Record<string, string>).website.length > 0) {
      return NextResponse.json({ ok: true });
    }

    const parsed = contactSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check the form and try again." }, { status: 400 });
    }
    const { category, profileCode, email, subject, message } = parsed.data;

    // The same person sending the same message twice within ten minutes (a double click, a retry) creates one record.
    const duplicate = await prisma.supportMessage.findFirst({
      where: { email, subject, message, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (!duplicate) {
      await prisma.supportMessage.create({
        data: { profileCode: profileCode ?? null, email, subject, message, category, consentAt: new Date() },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
