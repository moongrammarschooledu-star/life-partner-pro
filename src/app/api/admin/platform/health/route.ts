import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getHealthReport } from "@/lib/ops/health";
import { currentEnvironment } from "@/lib/platform/environment";
import { fromHealthCheck } from "@/lib/platform/provider-status";
import { listProviderViews } from "@/lib/platform/providers";

export const dynamic = "force-dynamic";

// Platform health in one vocabulary. Check detail is the existing, already-redacted health report; provider rows are the safe provider views.
export async function GET() {
  try {
    await requireAdmin("platform:health:view");
    const [report, providers] = await Promise.all([getHealthReport({ detail: true }), listProviderViews().catch(() => [])]);
    const checks = Object.entries(report.checks).map(([key, c]) => ({ key, status: fromHealthCheck(c.status), detail: c.detail ?? "" }));
    return NextResponse.json({ environment: currentEnvironment(), overall: report.status, checks, providers: providers.map((p) => ({ key: p.key, label: p.label, status: p.status, lastCheckedAt: p.lastCheck?.checkedAt ?? null })), generatedAt: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error);
  }
}