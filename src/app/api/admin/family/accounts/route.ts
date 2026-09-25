import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Admin → Family Accounts (spec §63) — search/list. Admins do not
// automatically receive unlimited family data; existing RBAC still applies
// via the family:manage permission gate.
export async function GET(req: Request) {
  try {
    await requireAdmin("family:manage");
    const q = new URL(req.url).searchParams.get("q")?.trim();

    const where = q
      ? { OR: [{ familyCode: { contains: q, mode: "insensitive" as const } }, { applicant: { profileCode: { contains: q, mode: "insensitive" as const } } }] }
      : {};

    const accounts = await prisma.familyAccount.findMany({
      where,
      select: {
        id: true,
        familyCode: true,
        status: true,
        createdAt: true,
        applicant: { select: { id: true, profileCode: true, fullName: true } },
        members: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      items: accounts.map((a) => ({ id: a.id, familyCode: a.familyCode, status: a.status, createdAt: a.createdAt, applicant: a.applicant, memberCount: a.members.length, activeMemberCount: a.members.filter((m) => m.status === "ACTIVE").length })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
