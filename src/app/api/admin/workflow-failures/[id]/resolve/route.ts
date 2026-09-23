import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { resolveWorkflowFailure } from "@/lib/workflow/retry";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("tasks:workflow-failures:resolve");
    const { id } = await params;
    const { resolution, reason } = (await req.json()) as { resolution?: "RESOLVED" | "IGNORED"; reason?: string };
    if (resolution !== "RESOLVED" && resolution !== "IGNORED") throw new ApiError(400, "resolution must be RESOLVED or IGNORED.");

    await resolveWorkflowFailure(id, admin.id, resolution, reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
