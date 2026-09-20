import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("alerts:manage");
    const { id } = await params;
    const { status } = await readJson<{ status?: string }>(req);
    if (status !== "ACKNOWLEDGED" && status !== "RESOLVED" && status !== "NEW") throw new ApiError(400, "Invalid status.");
    const updated = await prisma.errorEvent.update({
      where: { id },
      data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null, resolvedById: status === "RESOLVED" ? admin.id : null },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
