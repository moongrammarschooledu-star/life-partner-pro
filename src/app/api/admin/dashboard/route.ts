import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { ensureAllProfileVerifications } from "@/lib/verification/status";
import { computeFullDashboard } from "@/lib/dashboard/full-dashboard";
import { computeStaffDashboard } from "@/lib/dashboard/staff-dashboard";
import { hasAssignedWorkQueue } from "@/lib/permissions";

// Spec §10/§47 — role-adaptive dashboard, enforced here (not just hidden
// client-side): a role with a personal assigned work queue (STEP 17 — the 4
// *_STAFF roles) gets a reduced, assignment-derived payload; every other role
// (managers/Super Admin, and REPORTING_ANALYST/VIEWER, who have no assigned
// work queue at all) keeps the full org-wide KPI response, byte-identical to
// the pre-STEP-11 shape (see src/lib/dashboard/full-dashboard.ts). The
// "STAFF" tag in the response is a fixed client-side discriminant, not the
// admin's actual role.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("profile:view", { allowViewAs: true });
    await ensureAllProfileVerifications();

    if (hasAssignedWorkQueue(admin.role)) {
      const data = await computeStaffDashboard(admin.id);
      return NextResponse.json({ role: "STAFF", ...data });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") ?? "6m";
    const data = await computeFullDashboard(period);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
