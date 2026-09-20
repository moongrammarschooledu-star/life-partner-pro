import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { requestRestore, decideRestore, markRestoreExecuted, cancelRestore } from "@/lib/backup/restore-request";
import { runPostRestoreValidation } from "@/lib/ops/integrity";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Restore AUTHORIZATION (spec §58) — this never overwrites data. Create needs
// a verified backup + typed confirmation; approval needs a DIFFERENT admin.
// Both need SUPER_ADMIN-level permission and a fresh password re-confirmation.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("system:restore:approve");
    const limited = await enforcePersistentLimit(req, "admin-restore", 10, 600_000, admin.id);
    if (limited) return limited;

    const body = await readJson<{ backupId?: string; reason?: string; targetLabel?: string; typedConfirmation?: string; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "request a restore");
    if (!body.backupId) throw new ApiError(400, "A backup is required.");
    try {
      const created = await requestRestore({ backupId: body.backupId, reason: body.reason ?? "", targetLabel: body.targetLabel ?? "", typedConfirmation: body.typedConfirmation ?? "", actorId: admin.id });
      return NextResponse.json(created);
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Could not create the restore request.");
    }
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("system:restore:approve");
    const body = await readJson<{ requestId?: string; action?: "approve" | "reject" | "executed" | "cancel" | "validate"; notes?: string; stepUpToken?: string }>(req);
    if (!body.requestId && body.action !== "validate") throw new ApiError(400, "A request is required.");
    requireReauth(admin, body.stepUpToken, "act on a restore request");
    try {
      if (body.action === "approve") return NextResponse.json(await decideRestore({ requestId: body.requestId!, approve: true, actorId: admin.id, notes: body.notes }));
      if (body.action === "reject") return NextResponse.json(await decideRestore({ requestId: body.requestId!, approve: false, actorId: admin.id, notes: body.notes }));
      if (body.action === "executed") return NextResponse.json(await markRestoreExecuted({ requestId: body.requestId!, actorId: admin.id, notes: body.notes }));
      if (body.action === "cancel") return NextResponse.json(await cancelRestore({ requestId: body.requestId!, actorId: admin.id }));
      if (body.action === "validate") return NextResponse.json(await runPostRestoreValidation(admin.id));
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Action failed.");
    }
    throw new ApiError(400, "Unknown action.");
  } catch (error) {
    return handleApiError(error);
  }
}
