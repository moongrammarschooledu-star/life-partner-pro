import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientKeyFromRequest } from "@/lib/rate-limit";

// Persistent, cross-instance rate limiting (spec §19). The in-memory limiter
// in rate-limit.ts is per serverless instance and resets on cold start, so it
// cannot stop distributed brute force. This one keeps a counter row in
// Postgres updated by a single atomic INSERT … ON CONFLICT statement.
//
// Keys are hashed before storage (they may contain an IP or e-mail address).
// On a database error it FAILS OPEN: if the DB is down the protected actions
// (login, uploads, …) cannot succeed anyway, and a monitoring feature must
// never become the cause of an outage.

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export async function rateLimitPersistent(rawKey: string, limit: number, windowMs: number): Promise<{ allowed: boolean; count: number }> {
  const key = hashKey(rawKey);
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStartedAt")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStartedAt" < NOW() - make_interval(secs => ${windowSeconds}::double precision)
                       THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStartedAt" = CASE WHEN "RateLimitBucket"."windowStartedAt" < NOW() - make_interval(secs => ${windowSeconds}::double precision)
                       THEN NOW() ELSE "RateLimitBucket"."windowStartedAt" END
      RETURNING "count"`;
    const count = Number(rows[0]?.count ?? 1);
    return { allowed: count <= limit, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

export function tooManyRequests(retryAfterSeconds = 60): NextResponse {
  return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}

// Convenience for route handlers: returns a 429 response when the caller is
// over the limit (per client IP, plus optionally per subject such as an
// e-mail), otherwise null.
export async function enforcePersistentLimit(req: Request, name: string, limit: number, windowMs: number, subject?: string): Promise<NextResponse | null> {
  const ip = await rateLimitPersistent(`${name}:ip:${clientKeyFromRequest(req)}`, limit, windowMs);
  if (!ip.allowed) return tooManyRequests(Math.round(windowMs / 1000));
  if (subject) {
    const sub = await rateLimitPersistent(`${name}:sub:${subject.toLowerCase()}`, limit, windowMs);
    if (!sub.allowed) return tooManyRequests(Math.round(windowMs / 1000));
  }
  return null;
}

export async function cleanupRateLimitBuckets(): Promise<number> {
  const result = await prisma.rateLimitBucket.deleteMany({ where: { windowStartedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
  return result.count;
}
