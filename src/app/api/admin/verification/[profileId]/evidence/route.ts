import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import { maskEmail, maskPhone } from "@/lib/verification/otp";
import { resolvePurposeForPermission } from "@/lib/compliance/purpose-mapping";

// Read-only aggregation view (spec §24) — no new evidence table. Every
// record here already exists and is already immutable-by-construction
// (nothing in this app ever edits a VerificationDocument's review history,
// an OtpVerification row, or a SecurityFlag's creation record in place);
// this route just assembles them into one timeline-friendly response and
// access-logs the view.
export async function GET(_req: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const admin = await requireAdmin("sensitive:verification:view");
    const { profileId } = await params;

    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
    if (!profile) throw new ApiError(404, "Profile not found");

    const [verification, documents, otpEvents, duplicateCandidates, riskSignals, notes] = await Promise.all([
      prisma.profileVerification.findUnique({ where: { profileId }, include: { items: true } }),
      prisma.verificationDocument.findMany({ where: { profileId }, orderBy: { uploadedAt: "desc" } }),
      prisma.otpVerification.findMany({ where: { profileId }, orderBy: { createdAt: "desc" } }),
      prisma.duplicateCandidate.findMany({ where: { OR: [{ profileId }, { candidateProfileId: profileId }] }, orderBy: { createdAt: "desc" } }),
      prisma.securityFlag.findMany({ where: { profileId }, orderBy: { createdAt: "desc" } }),
      prisma.profileNote.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 20, include: { admin: { select: { name: true } } } }),
    ]);

    await logPrivacyAccess({ actorAdminId: admin.id, action: "VERIFICATION_EVIDENCE_VIEWED", field: "verificationDocument", targetProfileId: profileId, purpose: resolvePurposeForPermission("sensitive:verification:view") });

    return NextResponse.json({
      verification: verification
        ? {
            status: verification.status,
            phoneVerifiedAt: verification.phoneVerifiedAt,
            emailVerifiedAt: verification.emailVerifiedAt,
            providerName: verification.providerName,
            providerStatus: verification.providerStatus,
            items: verification.items.map((i) => ({ itemKey: i.itemKey, status: i.status, completedAt: i.completedAt })),
            lastReviewedAt: verification.lastReviewedAt,
          }
        : null,
      documents: documents.map((d) => ({ id: d.id, documentType: d.documentType, reviewStatus: d.reviewStatus, uploadedAt: d.uploadedAt, reviewedAt: d.reviewedAt })),
      // Never the raw code/token — masked destination only, same as every
      // other OTP-adjacent surface in this app.
      otpEvents: otpEvents.map((o) => ({ id: o.id, channel: o.channel, destinationMasked: o.channel === "EMAIL" ? maskEmail(o.destinationMasked) : maskPhone(o.destinationMasked), status: o.status, createdAt: o.createdAt })),
      duplicateSignals: duplicateCandidates.map((c) => ({ id: c.id, candidateCode: c.candidateCode, confidenceBand: c.confidenceBand, status: c.status, createdAt: c.createdAt })),
      riskSignals: riskSignals.map((f) => ({ id: f.id, flagType: f.flagType, severity: f.severity, status: f.status, createdAt: f.createdAt })),
      adminReviews: notes.map((n) => ({ id: n.id, text: n.text, adminName: n.admin.name, createdAt: n.createdAt })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
