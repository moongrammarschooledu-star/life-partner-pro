import { handlers } from "@/lib/auth";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

export const { GET } = handlers;

// STEP 15 §19 — the credentials sign-in POST is throttled persistently per IP
// (the per-account lockout in admin-login.ts still applies underneath).
export async function POST(req: Request) {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    const limited = await enforcePersistentLimit(req, "admin-signin", 40, 15 * 60_000);
    if (limited) return limited;
  }
  return handlers.POST(req as Parameters<typeof handlers.POST>[0]);
}
