import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { readJson, requireReauth, requireReason } from "@/lib/ops/admin-route";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { getGoLiveView, actOnGoLive } from "@/lib/ops/go-live";
import type { GoLiveAction } from "@/lib/ops/go-live-rules";

// STEP 34 §45 - go-live approval gate. Reading needs readiness:view. Changing it needs golive:manage AND a fresh password confirmation; the
// maker-checker rule (a different administrator approves) is enforced by the rules module, not here. READY can only be reached through
// the production-readiness evaluator - there is no way to type it in.
export const maxDuration = 60;

const ACTIONS: GoLiveAction[] = ["MARK_READY", "APPROVE", "GO_LIVE", "BLOCK"];

export async function GET() {
  try {
    await requireAdmin("readiness:view");
    return NextResponse.json(await getGoLiveView());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("golive:manage");
    const limited = await enforcePersistentLimit(req, "admin-go-live", 10, 600_000, admin.id);
    if (limited) return limited;
    const body = await readJson<{ action?: string; reason?: string; stepUpToken?: string }>(req);
    const action = ACTIONS.find((a) => a === body.action);
    if (!action) throw new HttpError(400, "Unknown action.");
    requireReauth(admin, body.stepUpToken, "change the go-live status");
    const reason = action === "BLOCK" ? requireReason(body.reason) : typeof body.reason === "string" ? body.reason : null;
    return NextResponse.json(await actOnGoLive({ action, actorId: admin.id, reason }));
  } catch (error) {
    return handleApiError(error);
  }
}
