import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { CHECKLIST_CATALOG } from "@/lib/verification/checklist-catalog";
import { computeProfileCompleteness } from "@/lib/verification/completeness";
import { computeConfidence } from "@/lib/verification/confidence";

// Full detail for the 3-pane Admin Verification Review page (spec §14):
// profile summary, checklist, documents, open flags, and history.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:view");
    const { id } = await params;

    const profile = await prisma.profile.findUnique({ where: { id }, include: profileDetailInclude });
    if (!profile) throw new ApiError(404, "Profile not found");

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });

    let verification = await prisma.profileVerification.findUnique({
      where: { profileId: id },
      include: {
        items: { include: { document: true } },
        assignedTo: { select: { id: true, name: true } },
        lastReviewedBy: { select: { name: true } },
      },
    });
    if (!verification) {
      await prisma.profileVerification.create({
        data: { profileId: id, items: { create: CHECKLIST_CATALOG.map((c) => ({ itemKey: c.key })) } },
      });
      verification = await prisma.profileVerification.findUnique({
        where: { profileId: id },
        include: { items: { include: { document: true } }, assignedTo: { select: { id: true, name: true } }, lastReviewedBy: { select: { name: true } } },
      });
    }

    // Only a presence boolean is read here, never the raw mobile/email/
    // WhatsApp value — this route uses profileDetailInclude specifically
    // because ContactInfo must never be fetched outside the explicit
    // reveal endpoint (see serializers.ts).
    const hasWhatsapp = !!(await prisma.contactInfo.findUnique({ where: { profileId: id }, select: { whatsappNumber: true } }))?.whatsappNumber;

    const [documents, flags, notes] = await Promise.all([
      prisma.verificationDocument.findMany({ where: { profileId: id }, orderBy: { uploadedAt: "desc" } }),
      prisma.securityFlag.findMany({
        where: { profileId: id },
        include: { relatedProfile: { select: { id: true, fullName: true, profileCode: true } }, assignedTo: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.profileNote.findMany({ where: { profileId: id }, include: { admin: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    ]);

    const { percent, categories } = computeProfileCompleteness({
      fullName: profile.fullName,
      gender: profile.gender,
      dateOfBirth: profile.dateOfBirth,
      maritalStatus: profile.maritalStatus,
      heightCm: profile.heightCm,
      city: profile.city,
      country: profile.country,
      nationality: profile.nationality,
      area: profile.area,
      // Mobile/email are required at registration, so their presence can be
      // assumed without fetching the raw values (see the hasWhatsapp query above).
      contact: { mobileNumber: "present", email: "present", whatsappNumber: hasWhatsapp ? "present" : null },
      phoneVerified: !!verification?.phoneVerifiedAt,
      emailVerified: !!verification?.emailVerifiedAt,
      education: profile.education,
      profession: profile.profession,
      family: profile.family,
      lifestyle: profile.lifestyle,
      preference: profile.preference,
      hasPhoto: profile.photos.length > 0,
    });

    const completedItems = verification?.items.filter((i) => i.status === "COMPLETED").length ?? 0;
    const applicableItems = verification?.items.filter((i) => i.status !== "NOT_APPLICABLE").length ?? CHECKLIST_CATALOG.length;
    const openHighOrCriticalFlag = flags.some((f) => f.status === "OPEN" && (f.severity === "HIGH" || f.severity === "CRITICAL"));

    const confidence = computeConfidence({
      phoneVerified: !!verification?.phoneVerifiedAt,
      emailVerified: !!verification?.emailVerifiedAt,
      checklistCompletionRatio: applicableItems > 0 ? completedItems / applicableItems : 0,
      adminReviewCompleted: verification?.status === "VERIFIED",
      documentVerificationEnabled: !!settings?.documentVerificationEnabled,
      documentVerificationApproved: documents.length > 0 && documents.every((d) => d.reviewStatus === "APPROVED"),
      hasOpenHighOrCriticalFlag: openHighOrCriticalFlag,
    });

    return NextResponse.json({
      profile: toDetailDto(profile, admin.id, admin.permissions),
      profileStatus: profile.status,
      registeredAt: profile.createdAt,
      verification: {
        id: verification!.id,
        status: verification!.status,
        assignedTo: verification!.assignedTo,
        phoneVerifiedAt: verification!.phoneVerifiedAt,
        emailVerifiedAt: verification!.emailVerifiedAt,
        whatsappVerifiedAt: verification!.whatsappVerifiedAt,
        requestedInfoItems: verification!.requestedInfoItems ? JSON.parse(verification!.requestedInfoItems) : [],
        rejectionReasonCategory: verification!.rejectionReasonCategory,
        rejectionNote: verification!.rejectionNote,
        suspensionReason: verification!.suspensionReason,
        reVerificationReason: verification!.reVerificationReason,
        lastReviewedAt: verification!.lastReviewedAt,
        lastReviewedByName: verification!.lastReviewedBy?.name ?? null,
      },
      checklist: CHECKLIST_CATALOG.map((entry) => {
        const item = verification!.items.find((i) => i.itemKey === entry.key);
        return {
          key: entry.key,
          category: entry.category,
          label: entry.label,
          requiresDocument: entry.requiresDocument,
          status: item?.status ?? "PENDING",
          note: item?.note ?? null,
          documentId: item?.documentId ?? null,
        };
      }),
      documents: documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        reviewStatus: d.reviewStatus,
        uploadedAt: d.uploadedAt,
        reviewNote: d.reviewNote,
        mimeType: d.mimeType,
      })),
      flags: flags.map((f) => ({
        id: f.id,
        flagType: f.flagType,
        severity: f.severity,
        status: f.status,
        description: f.description,
        assignedToName: f.assignedTo?.name ?? null,
        relatedProfile: f.relatedProfile,
        createdAt: f.createdAt,
      })),
      notes: notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt, adminName: n.admin.name })),
      completeness: { percent, categories },
      confidence,
      documentVerificationEnabled: !!settings?.documentVerificationEnabled,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
