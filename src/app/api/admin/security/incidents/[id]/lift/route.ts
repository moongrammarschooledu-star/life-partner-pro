import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { liftTechnicalControl } from "@/lib/risk/technical-controls";

// STEP 24 - lift a technical control before it expires.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("security:incidents:manage");
    const { id } = await params;
    const lifted = await liftTechnicalControl(id, admin);
    return NextResponse.json({ id: lifted.id, status: lifted.status });
  } catch (error) {
    return handleApiError(error);
  }
}
