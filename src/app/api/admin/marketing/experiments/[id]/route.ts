import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getExperimentReport } from "@/lib/marketing/experiments";
import { marketingError, noStore } from "@/lib/marketing/route-utils";

// Report only — it never promotes a variant. Below the minimum sample it says INSUFFICIENT_DATA.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("marketing:experiments:view");
    const { id } = await params;
    return NextResponse.json(await getExperimentReport(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
