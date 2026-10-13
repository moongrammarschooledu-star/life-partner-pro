import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { endBreakGlass, grantBreakGlass, listBreakGlass, reviewBreakGlass } from "@/lib/platform/break-glass";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin("platform:break_glass");
    return NextResponse.json({ items: await listBreakGlass() });
  } catch (error) {
    return handleApiError(error);
  }
}

// Platform break-glass: a time-limited exception to the change freeze. It never changes the administrator's role or grants any permission, and the use is
// reviewed afterwards by a DIFFERENT administrator.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("platform:break_glass");
    const body = await readJson<{ action?: unknown; id?: unknown; reason?: unknown; minutes?: unknown; note?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    requireReauth(admin, body.stepUpToken, "use break-glass");
    if (body.action === "END") return NextResponse.json(await endBreakGlass(admin));
    if (body.action === "REVIEW") return NextResponse.json(await reviewBreakGlass(admin, String(body.id ?? ""), body.note));
    return NextResponse.json(await grantBreakGlass(admin, { reason: body.reason, minutes: body.minutes, environment: body.environment }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}