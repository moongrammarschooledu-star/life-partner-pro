import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { ensureAllProfileVerifications } from "@/lib/verification/status";
import { computeFullDashboard } from "@/lib/dashboard/full-dashboard";
import { computeStaffDashboard } from "@/lib/dashboard/staff-dashboard";

// Spec §10 — role-adaptive dashboard, enforced here (not just hidden
// client-side): STAFF gets a reduced, assignment-derived payload; every
// other role keeps the full org-wide KPI response, byte-identical to the
// pre-STEP-11 shape (see src/lib/dashboard/full-dashboard.ts).
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("profile:view", { allowViewAs: true });
    await ensureAllProfileVerifications();

    if (admin.role === "STAFF") {
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
