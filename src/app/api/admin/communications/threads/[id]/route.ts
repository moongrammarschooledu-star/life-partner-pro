import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { listStaffThreadMessages } from "@/lib/communications/thread-service";

// Messages are filtered by visibility: INTERNAL_ONLY is the author's (or a log viewer's), MANAGER_ONLY needs the sensitive permission.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:view");
    const { id } = await params;
    return NextResponse.json(await listStaffThreadMessages(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}
