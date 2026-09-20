import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/ops/health";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Public summary (spec §11): per-dependency STATUS only — no detail strings,
// no hostnames, no secrets. The detailed view is admin-only (System Health).
export async function GET(req: Request) {
  if (!rateLimit(`health:${clientKeyFromRequest(req)}`, 60, 60_000)) {
    return NextResponse.json({ status: "rate_limited" }, { status: 429 });
  }
  const report = await getHealthReport({ detail: false });
  return NextResponse.json(report, { status: report.status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
