import { NextResponse } from "next/server";
import { getReadiness } from "@/lib/ops/health";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Readiness (spec §11): "can the app safely serve requests?" — database
// reachable, no CRITICAL configuration problem, not in RECOVERY/EMERGENCY.
// Public, so the body is coarse pass/fail only (no secrets, no internals).
export async function GET(req: Request) {
  if (!rateLimit(`health-ready:${clientKeyFromRequest(req)}`, 60, 60_000)) {
    return NextResponse.json({ status: "rate_limited" }, { status: 429 });
  }
  const readiness = await getReadiness();
  return NextResponse.json({ status: readiness.ready ? "ready" : "not_ready", checks: readiness.checks }, { status: readiness.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
