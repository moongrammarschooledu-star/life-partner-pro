import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getCrmTimeline } from "@/lib/crm/timeline-service";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:view");
    const { id } = await params;
    const take = Number(new URL(req.url).searchParams.get("take") ?? 200);

    const items = await getCrmTimeline(id, admin, Number.isFinite(take) && take > 0 ? Math.min(take, 500) : 200).catch((error) => {
      if (error instanceof Error && error.message === "CRM record not found") throw new ApiError(404, error.message);
      throw error;
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
