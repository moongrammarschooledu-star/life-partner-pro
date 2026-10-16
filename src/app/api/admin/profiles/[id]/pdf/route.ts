import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { readPhoto } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { buildProfilePdf, profileSections } from "@/lib/profile-pdf";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/public-site/config";
import { calculateAge, formatEnumLabel } from "@/lib/utils";

// Downloads a printable PDF of a VERIFIED profile (company logo, photo, the profile's features). It carries no contact details, notes, documents or risk
// information, shows income / family / religion only to an admin who may see them (the same redaction as the profile page), and every download is audited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:view");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);

    const profile = await prisma.profile.findUnique({ where: { id }, include: profileDetailInclude });
    if (!profile || profile.softDeleted) throw new ApiError(404, "Profile not found");
    if (!profile.verified) throw new ApiError(409, "Only a verified profile can be downloaded as a PDF.");

    const dto = toDetailDto(profile, admin.id, admin.permissions);

    // The main photo, decrypted on the server. A photo that cannot be read leaves the sheet without one instead of failing the download.
    let photo: { bytes: Uint8Array; kind: "jpg" | "png" } | null = null;
    const primary = profile.photos.find((p) => p.isPrimary) ?? profile.photos[0];
    if (primary) {
      try {
        const bytes = await readPhoto(primary.storageKey, primary.ivBase64, primary.authTagBase64);
        photo = { bytes, kind: primary.mimeType === "image/png" ? "png" : "jpg" };
      } catch {
        photo = null;
      }
    }

    // The logo is the public file the website already serves; a smaller copy keeps the PDF light. If it cannot be fetched the sheet simply has the name in text.
    let logoPng: Uint8Array | null = null;
    try {
      const res = await fetch(new URL("/logo-icon.png", req.url));
      if (res.ok) logoPng = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 200 }).png().toBuffer();
    } catch {
      logoPng = null;
    }

    const pdf = await buildProfilePdf({
      appName: SITE_NAME,
      tagline: SITE_TAGLINE,
      generatedAt: new Date(),
      profileCode: profile.profileCode,
      fullName: profile.fullName,
      headline: [formatEnumLabel(profile.gender), `${calculateAge(profile.dateOfBirth)} years`, profile.city].filter(Boolean).join("  |  "),
      verified: true,
      sections: profileSections(dto),
      logoPng,
      photo,
      footer: `Confidential. Prepared by ${SITE_NAME} for matchmaking only. Contact details are not included. Please do not share or publish this sheet without the person's consent.`,
    });

    await writeAudit({ action: "SENSITIVE_DATA_EXPORTED", adminId: admin.id, targetProfileId: id, meta: { kind: "PROFILE_PDF", profileCode: profile.profileCode } });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${profile.profileCode}-profile.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
