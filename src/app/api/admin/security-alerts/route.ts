import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { computeSecurityAlerts } from "@/lib/security-alerts";

// Spec §33 — Super Admin only.
export async function GET() {
  try {
    await requireAdmin("admin:manage");
    const alerts = await computeSecurityAlerts();
    return NextResponse.json({ items: alerts });
  } catch (error) {
    return handleApiError(error);
  }
}
