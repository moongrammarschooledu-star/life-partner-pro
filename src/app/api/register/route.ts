import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { registrationSchema } from "@/lib/validation/registration";
import { savePhoto, UploadValidationError } from "@/lib/storage";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { createProfileFromRegistration, ProfileCreationError } from "@/lib/profile-creation";
import { signProfileToken, signSessionId, APPLICANT_COOKIE, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { createProfileSession } from "@/lib/profile-session";
import { blockedResponse } from "@/lib/ops/guards";
import { withRequestMetrics } from "@/lib/observability/metrics";

const GENERIC_ERROR = "Your profile could not be submitted. Please check the highlighted fields.";

async function postHandler(req: Request) {
  const blocked = await blockedResponse({ switches: ["registrations", "profileSubmissions"], flags: ["registrations.enabled"] });
  if (blocked) return blocked;
  const key = `register:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many submissions. Please try again in a minute." }, { status: 429 });
  }

  try {
    // STEP 15 §57 — a malformed body (wrong content type, broken JSON) is a client
    // error, not a server fault: answer 400 instead of surfacing a 500.
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
    }
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") {
      return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
    }

    let parsed: { hp?: unknown } & Record<string, unknown>;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
    }

    // Honeypot: a real user never sees or fills this field (visually hidden
    // in the wizard). A non-empty value is treated identically to any other
    // validation failure — no signal is given back to distinguish a bot.
    if (typeof parsed.hp === "string" && parsed.hp.length > 0) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    const result = registrationSchema.safeParse(parsed);
    if (!result.success) {
      return NextResponse.json({ error: GENERIC_ERROR, issues: result.error.issues }, { status: 400 });
    }
    const value = result.data;

    let photoData: { storageKey: string; mimeType: string; sizeBytes: number; ivBase64: string; authTagBase64: string } | null = null;
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      const buffer = Buffer.from(await photo.arrayBuffer());
      try {
        photoData = await savePhoto(buffer, photo.type);
      } catch (err) {
        if (err instanceof UploadValidationError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    let profile: { id: string };
    let profileCode: string;
    try {
      ({ profile, profileCode } = await createProfileFromRegistration(value, photoData, { ipHashSource: clientKeyFromRequest(req) }));
    } catch (err) {
      if (err instanceof ProfileCreationError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    // Powers the private /my-status page for this browser — no accounts,
    // no URL/ID exposure, just a signed cookie scoped to this one profile.
    const cookieStore = await cookies();
    cookieStore.set(APPLICANT_COOKIE, signProfileToken(profile.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    const session = await createProfileSession(profile.id, undefined, req.headers.get("user-agent") ?? undefined);
    cookieStore.set(APPLICANT_SESSION_ID_COOKIE, signSessionId(session.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return NextResponse.json({ profileCode });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

// STEP 15 §17 — latency/error buckets for this critical route (System Health → Performance).
export const POST = withRequestMetrics("POST /api/register", postHandler);
