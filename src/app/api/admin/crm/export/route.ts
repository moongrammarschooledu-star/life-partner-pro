import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import type { CrmLifecycleStage } from "@prisma/client";

// A field-limited CSV export — never includes CrmNote bodies or any linked-
// domain content (documents/communications/risk), matching spec §35's
// export-scope rule; a scoped role only ever exports what it can already see.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("crm:export");
    const q = new URL(req.url).searchParams;

    const records = await prisma.crmRecord.findMany({
      where: {
        ...(q.get("lifecycleStage") ? { lifecycleStage: q.get("lifecycleStage") as CrmLifecycleStage } : {}),
        ...(!hasBroadRecordAccess(admin.role) ? { assignedStaffId: admin.id } : {}),
      },
      include: {
        profile: { select: { profileCode: true, fullName: true, city: true, country: true } },
        assignedStaff: { select: { name: true } },
      },
      take: 5000,
    });

    const header = ["CRM Code", "Applicant", "Profile Code", "City", "Country", "Lifecycle Stage", "Assigned To", "Priority", "Last Activity"];
    const rows = records.map((r) => [
      r.crmCode,
      r.profile.fullName,
      r.profile.profileCode,
      r.profile.city ?? "",
      r.profile.country ?? "",
      r.lifecycleStage,
      r.assignedStaff?.name ?? "Unassigned",
      r.priority,
      r.lastActivityAt?.toISOString() ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

    await writeAudit({ action: "CRM_EXPORT", adminId: admin.id, meta: { recordCount: records.length } });

    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=crm-export.csv" } });
  } catch (error) {
    return handleApiError(error);
  }
}
