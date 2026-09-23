import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { escalateApproval } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:escalate");
    const { id } = await params;
    const body = (await req.json()) as { reason?: string };
    const reason = requireReason(body.reason, 5);

    const updated = await escalateApproval(id, admin.id, reason);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
