import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getPublicFunnel, getPublicSiteStatus } from "@/lib/public-site/funnel";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAdmin("marketing:analytics:view");
    const days = Number(new URL(req.url).searchParams.get("days")) || 30;
    const [funnel, status] = await Promise.all([getPublicFunnel(days), getPublicSiteStatus()]);
    return NextResponse.json({ ...funnel, status });
  } catch (error) {
    return handleApiError(error);
  }
}
