import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { transitionPost } from "@/lib/content/service";
import { transitionSchema } from "@/lib/content/schemas";
import { permissionForAction } from "@/lib/content/status";

export const dynamic = "force-dynamic";

// One endpoint for every workflow step. The permission needed depends on the step (editing, publishing or archiving), so the body is
// read first and only then is the matching permission demanded; nothing is changed before requireAdmin has passed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(); // a signed-in administrator, before anything in the body is looked at
    const parsed = transitionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Unknown action.");
    const admin = await requireAdmin(permissionForAction(parsed.data.action));
    const { id } = await params;
    const result = await transitionPost(admin.id, id, parsed.data.action, { scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
