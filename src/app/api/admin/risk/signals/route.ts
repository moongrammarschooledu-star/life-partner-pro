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
];

export async function GET(req: Request) {
  try {
    await requireAdmin("risk:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");

    const flags = await prisma.securityFlag.findMany({
      where: {
        flagType: { in: RISK_SIGNAL_TYPES },
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
