import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { updateReportStatus } from "@/lib/risk/report-service";
import type { UserReportStatus } from "@prisma/client";

const STATUSES: UserReportStatus[] = ["RECEIVED", "UNDER_REVIEW", "ACTION_TAKEN", "NO_ACTION_NEEDED", "CLOSED"];

// STEP 24 - move a report through its lifecycle. The resolution note is reporter-visible, so it must stay neutral.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("user-reports:manage");
    const { id } = await params;
    const body = await readJson<{ status?: string; resolutionNote?: unknown }>(req);
    if (!STATUSES.includes(body.status as UserReportStatus)) throw new ApiError(400, "A valid status is required.");
    const updated = await updateReportStatus(id, admin, body.status as UserReportStatus, typeof body.resolutionNote === "string" ? body.resolutionNote : undefined);
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (error) {
    return handleApiError(error);
  }
}
