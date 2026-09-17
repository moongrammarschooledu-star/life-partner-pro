import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { DataCategory, RetentionAction } from "@prisma/client";

const ALL_CATEGORIES: DataCategory[] = [
  "ACCOUNT_DATA", "PROFILE_DATA", "CONTACT_DATA", "PHOTOS", "VERIFICATION_DOCUMENTS",
  "CONSENT_RECORDS", "PROPOSAL_RECORDS", "MEETING_RECORDS", "COMMUNICATION_RECORDS",
  "SUPPORT_CASES", "SAFETY_CASES", "AUDIT_LOGS", "SECURITY_LOGS", "FINANCIAL_RECORDS",
];

// Spec §16 — Super-Admin configures periods; nothing is hard-coded. Returns
// every category with its policy (or null if never configured) so the admin
// UI can show a full, explicit list rather than only what's been touched.
export async function GET() {
  try {
    await requireAdmin("privacy:retention:view");
    const policies = await prisma.retentionPolicy.findMany();
    const byCategory = new Map(policies.map((p) => [p.category, p]));
    return NextResponse.json({ items: ALL_CATEGORIES.map((category) => byCategory.get(category) ?? { category, retentionDays: null, action: null, isActive: false }) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("privacy:retention:manage");
    const { category, retentionDays, action, isActive } = (await req.json()) as {
      category?: DataCategory; retentionDays?: number; action?: RetentionAction; isActive?: boolean;
    };
    if (!category || !ALL_CATEGORIES.includes(category)) throw new Error("A valid category is required.");
    if (typeof retentionDays !== "number" || retentionDays < 0) throw new Error("A valid retention period is required.");
    if (!action) throw new Error("A retention action is required.");

    const policy = await prisma.retentionPolicy.upsert({
      where: { category },
      update: { retentionDays, action, isActive: isActive ?? true, updatedById: admin.id },
      create: { category, retentionDays, action, isActive: isActive ?? true, updatedById: admin.id },
    });

    return NextResponse.json(policy);
  } catch (error) {
    return handleApiError(error);
  }
}
