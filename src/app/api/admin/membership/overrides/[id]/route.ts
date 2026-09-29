import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { revokeOverrideGrant } from "@/lib/finance/entitlements";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:entitlements:manage");
    const { id } = await params;
    const revoked = await revokeOverrideGrant(admin.id, id);
    return NextResponse.json({ override: revoked });
  } catch (error) {
    return handleApiError(error);
  }
}
