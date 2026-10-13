import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson, requireReauth } from "@/lib/ops/admin-route";
import { listProviderViews, providerCheckHistory } from "@/lib/platform/providers";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";
import { recordConfigChange } from "@/lib/platform/config-change";
import { updateProvider } from "@/lib/communications/provider-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("platform:providers:view");
    const { id } = await params;
    const provider = (await listProviderViews()).find((p) => p.key === id);
    if (!provider) throw new ApiError(404, "Not found.");
    return NextResponse.json({ provider, history: await providerCheckHistory(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

// Enable or disable a COMMUNICATION provider (the one provider change this screen performs). The existing provider service does the change, with its own
// approval rule; this route adds the environment, reason, change freeze and the history entry. Everything else about a provider is edited in its own screen.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:providers:manage");
    const { id } = await params;
    if (!id.startsWith("comm:")) throw new ApiError(400, "Only communication providers can be switched on or off here. Use the provider's own screen for the others.");
    const body = await readJson<{ active?: unknown; reason?: unknown; environment?: unknown; stepUpToken?: string }>(req);
    if (typeof body.active !== "boolean") throw new ApiError(400, "active must be true or false.");
    requireReauth(admin, body.stepUpToken, "change a provider");
    const ctx = await assertConfigChangeAllowed({ admin, environment: body.environment, reason: body.reason, restrictive: body.active === false, what: { kind: "PROVIDER", key: id } });
    const row = await prisma.communicationProvider.findUnique({ where: { providerKey: id.slice(5) } });
    if (!row) throw new ApiError(404, "Not found.");
    const result = await updateProvider(admin, row.id, { active: body.active });
    if ("approvalRequired" in result && result.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: result.approvalCode }, { status: 202 });
    await recordConfigChange({ kind: "PROVIDER", key: id, before: { active: row.active }, after: { active: body.active }, actor: admin, reason: ctx.reason, environment: ctx.environment });
    return NextResponse.json({ key: id, active: body.active });
  } catch (error) {
    return handleApiError(error);
  }
}