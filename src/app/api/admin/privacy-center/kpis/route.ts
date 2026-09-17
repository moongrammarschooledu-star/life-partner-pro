import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("privacy:view");

    const [activeConsents, pendingPrivacyRequests, deletionRequests, exportRequests, retentionDue, legalHolds, privacyIncidents, restrictedProfiles] = await Promise.all([
      prisma.consentGrant.count({ where: { status: "GRANTED" } }),
      prisma.privacyRequest.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      prisma.accountDeletionRequest.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCHEDULED", "PROCESSING"] } } }),
      prisma.dataExportRequest.count({ where: { status: { in: ["PENDING", "READY"] } } }),
      prisma.accountDeletionRequest.count({ where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } } }),
      prisma.dataHold.count({ where: { active: true } }),
      prisma.case.count({ where: { type: "PRIVACY_INCIDENT", status: { notIn: ["RESOLVED", "CLOSED", "ARCHIVED"] } } }),
      prisma.profileRestriction.count({ where: { active: true } }),
    ]);

    return NextResponse.json({
      activeConsents,
      pendingPrivacyRequests,
      deletionRequests,
      exportRequests,
      retentionDue,
      legalHolds,
      privacyIncidents,
      restrictedProfiles,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
