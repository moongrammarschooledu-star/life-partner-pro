import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { enqueueJob } from "@/lib/ops/jobs";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { martDefinitions } from "@/lib/analytics/pipeline";
import { isDayKey } from "@/lib/analytics/time";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Queue a rebuild of derived data FROM SOURCE for one metric or mart over a date range. It runs as a background job; the operational
// tables are only ever read. A reason is required and the request is audited when the job runs.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("analytics:pipeline:manage");
    await assertEnabled("analytics.pipeline.enabled");
    const b = await readBody(req);
    const metricKey = str(b, "metricKey", { max: 80 });
    const martKey = str(b, "martKey", { max: 40 });
    if ((!metricKey && !martKey) || (metricKey && martKey)) throw new HttpError(400, "Choose a metric or a mart.");
    if (metricKey && (!getMetric(metricKey) || getMetric(metricKey)?.liveOnly)) throw new HttpError(400, "That metric is not stored in a data mart.");
    if (martKey && !martDefinitions().some((m) => m.key === martKey)) throw new HttpError(400, "Unknown mart.");
    const fromDay = str(b, "fromDay", { required: true, max: 10 });
    const toDay = str(b, "toDay", { required: true, max: 10 });
    if (!isDayKey(fromDay) || !isDayKey(toDay) || fromDay > toDay) throw new HttpError(400, "Choose a valid date range.");
    const reason = str(b, "reason", { required: true, max: 300 });
    const job = await enqueueJob({ type: "ANALYTICS_REBUILD", dedupKey: `analytics-rebuild:${metricKey || martKey}:${fromDay}:${toDay}`, payload: { metricKey: metricKey || undefined, martKey: martKey || undefined, fromDay, toDay, actorId: admin.id, reason }, createdById: admin.id });
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return marketingError(error);
  }
}
