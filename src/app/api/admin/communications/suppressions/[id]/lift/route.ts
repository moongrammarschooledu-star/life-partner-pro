import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { liftSuppression } from "@/lib/communications/suppression-service";
import { readJson, str } from "@/lib/communications/route-utils";

// Lifting is explicit, needs a reason and is audited - a suppression is never silently removed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:suppress");
    const { id } = await params;
    const body = await readJson(req);
    const row = await liftSuppression(id, admin.id, str(body.reason, "reason", { max: 300 }));
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (error) {
    return handleApiError(error);
  }
}
