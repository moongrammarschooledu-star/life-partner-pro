import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { assertContactShareAllowed, resolveAdHocContactAccessLevel, ContactShareDeniedError } from "@/lib/privacy/contact-access";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import { redactForAudit } from "@/lib/privacy/audit-redaction";

// Reveals contact info for a single profile. Every call is audited — this is
// the only code path in the app that ever reads ContactInfo for display.
// Gated at the "Admin Only" tier (spec §7) — a legitimate, named access
// level for ad-hoc admin support lookups, not a bypass of the graded
// proposal-driven share path in POST below.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // STEP 17 §17 — contact:reveal or sensitive:contact:view (either is
    // sufficient — see resolveAdHocContactAccessLevel) gates this endpoint;
    // requireAdmin() here only enforces authentication + session validity.
    const admin = await requireAdmin();
    const { id } = await params;

    if (resolveAdHocContactAccessLevel(admin) === "HIDDEN") {
      throw new ApiError(403, "You do not have permission to view contact information.");
    }

    const contact = await prisma.contactInfo.findUnique({ where: { profileId: id } });
    if (!contact) throw new ApiError(404, "Contact info not found");

    await writeAudit({ action: "CONTACT_VIEWED", adminId: admin.id, targetProfileId: id, meta: redactForAudit({ mobileNumber: contact.mobileNumber, email: contact.email }) });
    await logPrivacyAccess({ actorAdminId: admin.id, action: "CONTACT_VIEWED", field: "mobileNumber", targetProfileId: id });

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

// Shares contact between two profiles (spec §6/§7). Requires an approved
// ContactPermission on the given proposal for BOTH profiles ("Proposal
// Approved" tier); without a proposal, requires contact:reveal:override
// plus a mandatory reason ("Family Contact Approved" tier) or a scoped
// break-glass grant — never a bare admin-permission bypass, closing the gap
// the pre-STEP-13 code explicitly admitted it left open.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("contact:reveal");
    const { id } = await params;
    const { otherProfileId, proposalId, overrideReason, phoneShared, whatsappShared, emailShared } = await req.json();

    if (!otherProfileId) throw new ApiError(400, "otherProfileId is required");
    if (!phoneShared && !whatsappShared && !emailShared) {
      throw new ApiError(400, "At least one contact channel must be selected");
    }

    // Spec §18 — real backend enforcement, not a hidden button.
    const [aRestricted, bRestricted] = await Promise.all([
      hasActiveRestriction(id, "CANNOT_CONTACT_SHARE"),
      hasActiveRestriction(otherProfileId, "CANNOT_CONTACT_SHARE"),
    ]);
    if (aRestricted || bRestricted) {
      throw new ApiError(403, "One of these profiles is currently restricted from contact sharing.");
    }

    let accessResult;
    try {
      accessResult = await assertContactShareAllowed({ admin, proposalId, profileAId: id, profileBId: otherProfileId });
    } catch (error) {
      if (error instanceof ContactShareDeniedError) throw new ApiError(403, error.message);
      throw error;
    }
    if (accessResult.level === "FAMILY_CONTACT_APPROVED" && !overrideReason?.trim()) {
      throw new ApiError(400, "A reason is required to share contact information outside an approved proposal.");
    }

    const [profileAId, profileBId] = [id, otherProfileId].sort();

    const share = await prisma.contactShareLog.create({
      data: {
        profileAId,
        profileBId,
        approvedById: admin.id,
        phoneShared: !!phoneShared,
        whatsappShared: !!whatsappShared,
        emailShared: !!emailShared,
      },
    });

    await writeAudit({
      action: "CONTACT_SHARED",
      adminId: admin.id,
      targetProfileId: id,
      meta: { otherProfileId, shareId: share.id, accessLevel: accessResult.level, overrideReason: overrideReason ?? null, phoneShared: !!phoneShared, whatsappShared: !!whatsappShared, emailShared: !!emailShared },
    });
    await logPrivacyAccess({ actorAdminId: admin.id, action: "CONTACT_SHARED", field: "mobileNumber", targetProfileId: id, reason: overrideReason ?? null });

    return NextResponse.json({ ok: true, sharedAt: share.sharedAt, accessLevel: accessResult.level });
  } catch (error) {
    return handleApiError(error);
  }
}
