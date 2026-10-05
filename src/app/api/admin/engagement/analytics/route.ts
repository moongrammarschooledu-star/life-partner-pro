import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getChannelHealth, getCohorts, getEngagementFunnel, getRetention, getSnapshotSeries } from "@/lib/engagement/analytics";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Funnel, retention (D1/D7/D30), cohorts, channel health and daily series. Aggregates only; rates need a minimum sample.
export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:analytics:view");
    const q = new URL(req.url).searchParams;
    const days = Math.min(Math.max(Number(q.get("days") ?? 30) || 30, 1), 365);
    const kind = q.get("kind") ?? "funnel";
    let data: unknown;
    if (kind === "funnel") data = await getEngagementFunnel(days);
    else if (kind === "retention") data = await getRetention();
    else if (kind === "cohorts") data = await getCohorts();
    else if (kind === "channels") data = await getChannelHealth(Math.min(days, 90));
    else if (kind === "series") data = { metric: q.get("metric"), points: await getSnapshotSeries(q.get("metric") ?? "", days) };
    else return NextResponse.json({ error: "Unknown analytics kind." }, { status: 400 });
    return NextResponse.json(data, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
