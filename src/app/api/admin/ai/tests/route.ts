import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { z } from "zod";
import { readJson } from "@/lib/ops/admin-route";
import { runTests, listTestRuns } from "@/lib/ai/admin";

// AI test suites (spec §62-§64/§66): run the safety / privacy / security / reliability / analysis
// checks against synthetic profiles and record the result. Provider, model, prompt and rollout
// changes require a fresh passing run.
const schema = z.object({ suite: z.enum(["all", "safety", "privacy", "security", "reliability", "analysis"]).default("all") });

async function getHandler() {
  try {
    await requireAdmin("ai:test:run");
    return NextResponse.json({ items: await listTestRuns() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

async function postHandler(req: Request) {
  try {
    const admin = await requireAdmin("ai:test:run");
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: "Invalid suite." }, { status: 400 });
    return NextResponse.json(await runTests(admin, parsed.data.suite));
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withRequestMetrics("GET /api/admin/ai/tests", getHandler);
export const POST = withRequestMetrics("POST /api/admin/ai/tests", postHandler);
