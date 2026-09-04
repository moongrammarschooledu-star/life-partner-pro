import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { calculateAge, formatEnumLabel } from "@/lib/utils";

// CSV only for now — Excel/PDF need extra dependencies and are deferred
// (see README "Deferred / extension points"). Never includes contact info,
// consistent with the rest of the admin API surface.
function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? "");
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(",")
    )
    .join("\n");
}

export async function GET(req: Request) {
  try {
    await requireAdmin("audit:view");
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") ?? "profiles";

    let csv: string;
    let filename: string;

    if (type === "profiles") {
      const profiles = await prisma.profile.findMany({
        where: { softDeleted: false },
        include: { education: true, profession: true },
        orderBy: { createdAt: "desc" },
      });
      csv = toCsv([
        ["Profile ID", "Name", "Gender", "Age", "City", "Country", "Education", "Profession", "Status", "Verified", "Created"],
        ...profiles.map((p) => [
          p.profileCode,
          p.fullName,
          formatEnumLabel(p.gender),
          calculateAge(p.dateOfBirth),
          p.city,
          p.country,
          p.education?.level ?? "",
          p.profession?.profession ?? "",
          formatEnumLabel(p.status),
          p.verified ? "Yes" : "No",
          p.createdAt.toISOString().slice(0, 10),
        ]),
      ]);
      filename = "profiles.csv";
    } else if (type === "proposals") {
      const proposals = await prisma.proposal.findMany({
        include: {
          profileA: { select: { profileCode: true, fullName: true } },
          profileB: { select: { profileCode: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      csv = toCsv([
        ["Proposal ID", "Profile A", "Profile B", "Status", "Created"],
        ...proposals.map((p) => [
          p.id,
          `${p.profileA.fullName} (${p.profileA.profileCode})`,
          `${p.profileB.fullName} (${p.profileB.profileCode})`,
          formatEnumLabel(p.status),
          p.createdAt.toISOString().slice(0, 10),
        ]),
      ]);
      filename = "proposals.csv";
    } else {
      throw new ApiError(400, "Unknown export type");
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
