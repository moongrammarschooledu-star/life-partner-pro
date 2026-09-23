import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { createShortlist } from "@/lib/search/candidate-search";

// spec §28 — LPP-SHORT-######. GET lists the caller's own shortlists (a
// broad role sees all — mirrors every other owner-scoped list in this app).
export async function GET() {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const items = await prisma.shortlist.findMany({
      where: hasBroadRecordAccess(admin.role) ? {} : { ownerId: admin.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { items: true } } },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const body = (await req.json()) as { name?: string; description?: string; sourceProfileId?: string | null; profileIds?: string[] };
    if (!body.name?.trim()) throw new ApiError(400, "A name is required.");

    const shortlist = await createShortlist(admin, {
      name: body.name.trim(),
      description: body.description,
      sourceProfileId: body.sourceProfileId,
      profileIds: body.profileIds,
    });
    return NextResponse.json(shortlist);
  } catch (error) {
    return handleApiError(error);
  }
}
