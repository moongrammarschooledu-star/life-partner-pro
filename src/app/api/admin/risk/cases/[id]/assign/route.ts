import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { assignCase } from "@/lib/risk/case-service";

// STEP 24 - assign a case to an active reviewer. A case can never be assigned to its own subject. (Visibility is
// still enforced per request: an assignee without the security permission cannot open an admin-subject case.)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:investigate");
    const { id } = await params;
    const { assigneeId } = await readJson<{ assigneeId?: unknown }>(req);
    if (typeof assigneeId !== "string" || !assigneeId) throw new ApiError(400, "assigneeId is required.");
    const assignee = await prisma.adminUser.findFirst({ where: { id: assigneeId, active: true }, select: { id: true } });
    if (!assignee) throw new ApiError(404, "Reviewer not found.");
    const updated = await assignCase(id, admin, assignee.id);
    return NextResponse.json({ id: updated.id, assignedToId: updated.assignedToId });
  } catch (error) {
    return handleApiError(error);
  }
}
