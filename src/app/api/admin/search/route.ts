import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { calculateAge } from "@/lib/utils";

// Global topbar search — profiles only for now (name / Profile ID / phone /
// city / profession). Phone is matched via the private ContactInfo relation
// but never returned in the result payload — only used as a filter, same
// privacy rule as everywhere else contact data is touched.
export async function GET(req: Request) {
  try {
    await requireAdmin("profile:view");
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    const profiles = await prisma.profile.findMany({
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
    });

    return NextResponse.json({
      results: profiles.map((p) => ({
        id: p.id,
        profileCode: p.profileCode,
        fullName: p.fullName,
        gender: p.gender,
        age: calculateAge(p.dateOfBirth),
        city: p.city,
        status: p.status,
        profession: p.profession?.profession ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
