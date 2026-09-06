import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { notifySecurityFlagRaised } from "@/lib/notifications/events";
import type { SecurityFlagType, SecurityFlagSeverity } from "@prisma/client";

const VALID_TYPES: SecurityFlagType[] = [
  "MULTIPLE_REGISTRATIONS",
  "REPEATED_FAILED_OTP",
  "UNUSUAL_UPDATE_ACTIVITY",
  "SUSPICIOUS_ACCOUNT_BEHAVIOR",
  "DUPLICATE_PROFILE_SUSPECTED",
  "VERIFICATION_INCONSISTENCY",
  "ABUSIVE_BEHAVIOR_REPORT",
];
const VALID_SEVERITIES: SecurityFlagSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export async function GET(req: Request) {
  try {
    await requireAdmin("verification:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const severity = searchParams.get("severity");

    const flags = await prisma.securityFlag.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(severity ? { severity: severity as never } : {}),
      },
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true } },
        relatedProfile: { select: { id: true, profileCode: true, fullName: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: flags });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("verification:flag:manage");
    const { profileId, flagType, severity, description, relatedProfileId } = await req.json();

    if (!profileId || !VALID_TYPES.includes(flagType) || !description) {
      throw new ApiError(400, "profileId, a valid flagType, and description are required");
    }
    if (severity && !VALID_SEVERITIES.includes(severity)) throw new ApiError(400, "Invalid severity");

    const flag = await prisma.securityFlag.create({
      data: { profileId, flagType, severity: severity || "MEDIUM", description, relatedProfileId: relatedProfileId || null },
    });

    await writeAudit({ action: "SECURITY_FLAG_RAISED", adminId: admin.id, targetProfileId: profileId, meta: { flagId: flag.id, flagType } });
    await notifySecurityFlagRaised(profileId, flagType === "DUPLICATE_PROFILE_SUSPECTED", flag.id);

    return NextResponse.json(flag);
  } catch (error) {
    return handleApiError(error);
  }
}
