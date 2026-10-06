import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { FORECASTABLE, generateForecast } from "@/lib/analytics/forecast";
import { assertEnabled } from "@/lib/analytics/route-helpers";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// A transparent estimate of an AGGREGATE daily series. Withheld ("Insufficient verified data") when history is too short.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("analytics:forecast:view");
    await assertEnabled("analytics.forecast.enabled");
    const q = new URL(req.url).searchParams;
    const metric = q.get("metric");
    if (!metric) return NextResponse.json({ metrics: FORECASTABLE }, { headers: noStore });
    return NextResponse.json(await generateForecast(admin, metric, { horizonDays: Number(q.get("horizon") ?? 30) || 30, currency: q.get("currency") ?? "" }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
