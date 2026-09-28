import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getLogDetail } from "@/lib/communications/log-service";

// One message with its delivery timeline. The content itself needs sensitive:communication:view and each read is audited.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:logs:view");
    const { id } = await params;
    return NextResponse.json(await getLogDetail(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}
