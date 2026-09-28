import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { SecurityFlagType } from "@prisma/client";

// The Risk Signal Engine's queue — SecurityFlag IS the risk-signal store
// (STEP 23 plan decision 1); this is a filtered view over the same table
// the existing Security Flags page reads, excluding DUPLICATE_PROFILE_SUSPECTED
// (which has its own dedicated Duplicate Detection workspace, see
// /api/admin/duplicates) so the two admin surfaces never show overlapping rows.
const RISK_SIGNAL_TYPES: SecurityFlagType[] = [
  "MULTIPLE_REGISTRATIONS",
  "REPEATED_FAILED_OTP",
  "UNUSUAL_UPDATE_ACTIVITY",
  "SUSPICIOUS_ACCOUNT_BEHAVIOR",
  "VERIFICATION_INCONSISTENCY",
  "ABUSIVE_BEHAVIOR_REPORT",
  "RAPID_REGISTRATION_SIGNAL",
  "CONTACT_REUSE_SIGNAL",
  "EXCESSIVE_PROPOSAL_ACTIVITY",
  "ABNORMAL_CONTACT_REQUEST_ACTIVITY",
  "PAYMENT_ANOMALY_SIGNAL",
  // STEP 24 — the new signal families. DUPLICATE_PROFILE_SUSPECTED still belongs to the duplicates workspace.
  "LOGIN_ABUSE_SIGNAL",
  "OTP_ABUSE_SIGNAL",
  "CONTACT_BYPASS_ATTEMPT",
  "UNAUTHORIZED_ACCESS_ATTEMPT",
  "FAMILY_ACCESS_ABUSE_SIGNAL",
  "PROFILE_CHURN_SIGNAL",
  "IDENTITY_VERIFICATION_REVIEW",
  "SAFETY_REPORT_SIGNAL",
  "REPEATED_PAYMENT_FAILURE",
  "SHARED_DEVICE_SIGNAL", // hidden below unless the viewer holds sensitive:device:view
  "UNUSUAL_NETWORK_ACTIVITY", // hidden below unless the viewer holds sensitive:network:view
];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("risk:view");
    const visibleTypes = RISK_SIGNAL_TYPES.filter((t) => (t !== "SHARED_DEVICE_SIGNAL" || admin.permissions.includes("sensitive:device:view")) && (t !== "UNUSUAL_NETWORK_ACTIVITY" || admin.permissions.includes("sensitive:network:view")));
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");

    const flags = await prisma.securityFlag.findMany({
      where: {
        flagType: { in: visibleTypes },
        ...(status ? { status: status as never } : {}),
        ...(severity ? { severity: severity as never } : {}),
      },
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: flags });
  } catch (error) {
    return handleApiError(error);
  }
}
