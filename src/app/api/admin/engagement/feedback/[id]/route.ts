import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { handleFeedback } from "@/lib/engagement/feedback-service";
import { marketingError, readBody } from "@/lib/marketing/route-utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:feedback:manage");
    const { id } = await params;
    const b = await readBody(req);
    const row = await handleFeedback(admin, id, { status: b.status as never, internalNote: b.internalNote as string | null | undefined });
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (error) {
    return marketingError(error);
  }
}
