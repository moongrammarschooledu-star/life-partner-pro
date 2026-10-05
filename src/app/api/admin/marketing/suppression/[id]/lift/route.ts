import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { liftMarketingSuppression } from "@/lib/marketing/suppression";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// The row is kept (status LIFTED) — history stays answerable. Hard reasons need a longer written reason (service).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:suppression:manage");
    const { id } = await params;
    const b = await readBody(req);
    await liftMarketingSuppression(id, admin.id, str(b, "reason", { required: true, max: 500 }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return marketingError(error);
  }
}
