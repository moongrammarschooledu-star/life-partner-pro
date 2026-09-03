import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Reveals contact info for a single profile. Every call is audited — this is
// the only code path in the app that ever reads ContactInfo for display.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("contact:reveal");
    const { id } = await params;

    const contact = await prisma.contactInfo.findUnique({ where: { profileId: id } });
    if (!contact) throw new ApiError(404, "Contact info not found");

    await writeAudit({ action: "CONTACT_VIEWED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({
      mobileNumber: contact.mobileNumber,
      whatsappNumber: contact.whatsappNumber,
      email: contact.email,
      preferredContactMethod: contact.preferredContactMethod,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Shares contact between two profiles once an admin has approved doing so
// (spec §18) — writes a permanent, queryable audit trail.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("contact:reveal");
    const { id } = await params;
    const { otherProfileId } = await req.json();

    if (!otherProfileId) throw new ApiError(400, "otherProfileId is required");

    const [profileAId, profileBId] = [id, otherProfileId].sort();

    const share = await prisma.contactShareLog.create({
      data: { profileAId, profileBId, approvedById: admin.id },
    });

    await writeAudit({
      action: "CONTACT_SHARED",
      adminId: admin.id,
      targetProfileId: id,
      meta: { otherProfileId, shareId: share.id },
    });

    return NextResponse.json({ ok: true, sharedAt: share.sharedAt });
  } catch (error) {
    return handleApiError(error);
  }
}
