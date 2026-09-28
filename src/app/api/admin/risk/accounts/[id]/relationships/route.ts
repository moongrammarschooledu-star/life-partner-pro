import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getRelationshipGraph } from "@/lib/risk/relationship-graph";

// STEP 24 - bounded, admin-only relationship graph around one profile (profile codes and relationship types only).
// There is no applicant-facing equivalent anywhere, so relationship data can never reach a member.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("relationships:view");
    const { id } = await params;
    const exists = await prisma.profile.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new ApiError(404, "Profile not found.");
    const depth = Number(new URL(req.url).searchParams.get("depth") ?? 1) || 1;
    return NextResponse.json(await getRelationshipGraph(id, { actorAdminId: admin.id, depth }));
  } catch (error) {
    return handleApiError(error);
  }
}
