import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { calculateAge } from "@/lib/utils";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { hasBroadRecordAccess } from "@/lib/permissions";

// Global topbar search (spec §27) — profiles and proposals. Match has no
// natural human-searchable key so it's out of scope (documented deferred).
// Results respect the same assignment row-scoping as the dedicated list
// pages — an assignment-scoped searcher only ever sees proposals assigned to them.
async function getHandler(req: Request) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "admin-search", 120, 60000);
  if (limited) return limited;
  try {
    const admin = await requireAdmin("profile:view");
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    const [profiles, proposals] = await Promise.all([
      prisma.profile.findMany({
        where: {
          softDeleted: false,
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { profileCode: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
            { profession: { profession: { contains: q, mode: "insensitive" } } },
            { contact: { mobileNumber: { contains: q } } },
            { contact: { whatsappNumber: { contains: q } } },
          ],
        },
        select: {
          id: true,
          profileCode: true,
          fullName: true,
          gender: true,
          dateOfBirth: true,
          city: true,
          status: true,
          profession: { select: { profession: true } },
        },
        take: 8,
      }),
      prisma.proposal.findMany({
        where: {
          proposalCode: { contains: q, mode: "insensitive" },
          ...(hasBroadRecordAccess(admin.role) ? {} : { assignedToId: admin.id }),
        },
        select: {
          id: true,
          proposalCode: true,
          status: true,
          profileA: { select: { fullName: true } },
          profileB: { select: { fullName: true } },
        },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      results: profiles.map((p) => ({
        type: "profile" as const,
        id: p.id,
        profileCode: p.profileCode,
        fullName: p.fullName,
        gender: p.gender,
        age: calculateAge(p.dateOfBirth),
        city: p.city,
        status: p.status,
        profession: p.profession?.profession ?? null,
      })),
      proposalResults: proposals.map((p) => ({
        type: "proposal" as const,
        id: p.id,
        proposalCode: p.proposalCode,
        status: p.status,
        profileAName: p.profileA.fullName,
        profileBName: p.profileB.fullName,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// STEP 15 §17 — latency/error buckets for this critical route (System Health → Performance).
export const GET = withRequestMetrics("GET /api/admin/search", getHandler);
