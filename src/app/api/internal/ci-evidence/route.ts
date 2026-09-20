import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { rateLimitPersistent, tooManyRequests } from "@/lib/ops/rate-limit-persistent";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { resolveAppEnv } from "@/lib/config/validate";
import { EVIDENCE_KINDS } from "@/lib/ops/readiness";

// Pipeline evidence intake (spec §22/§49/§68). Called by GitHub Actions with
// `Authorization: Bearer $CI_EVIDENCE_TOKEN`. Not an admin route (no session),
// so it is protected by a shared secret compared in constant time, a
// persistent rate limit and strict body validation. If the token is not
// configured the endpoint refuses everything — evidence can't be forged.
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  const token = process.env.CI_EVIDENCE_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "Evidence ingestion is not configured." }, { status: 503 });

  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(supplied, token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimitPersistent(`ci-evidence:${clientKeyFromRequest(req)}`, 120, 60_000);
  if (!limit.allowed) return tooManyRequests();

  const text = await req.text();
  if (text.length > 20_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  let body: { kind?: unknown; status?: unknown; commitSha?: unknown; environment?: unknown; summary?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const kind = String(body.kind ?? "");
  const status = body.status === "PASS" ? "PASS" : body.status === "FAIL" ? "FAIL" : null;
  const commitSha = String(body.commitSha ?? "");
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind) || !status || !/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    return NextResponse.json({ error: "Invalid evidence." }, { status: 400 });
  }

  await prisma.ciEvidence.create({
    data: {
      kind,
      status,
      commitSha: commitSha.toLowerCase(),
      environment: typeof body.environment === "string" ? body.environment.slice(0, 20) : resolveAppEnv(process.env),
      summary: body.summary && typeof body.summary === "object" ? (body.summary as object) : undefined,
    },
  });
  return NextResponse.json({ ok: true });
}
