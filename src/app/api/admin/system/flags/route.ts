import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { readJson, requireReason } from "@/lib/ops/admin-route";
import { FEATURE_FLAG_DEFS, isKnownFeatureFlag } from "@/lib/ops/feature-flag-defs";
import { getAllFeatureFlags, invalidateFeatureFlags } from "@/lib/ops/feature-flags";

export async function GET() {
  try {
    await requireAdmin("system:view");
    const flags = await getAllFeatureFlags();
    return NextResponse.json({ items: FEATURE_FLAG_DEFS.map((d) => ({ ...d, enabled: flags[d.key] ?? true })), propagationNote: "Changes reach every server instance within ~30 seconds." });
  } catch (error) {
    return handleApiError(error);
  }
}

// Only registered flags can be changed (payments.enabled is managed in the
// Finance Center rollout system and is read-only here). Reason is mandatory
// and audited with the previous and new value.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("system:flags:manage");
    const body = await readJson<{ key?: string; enabled?: boolean; reason?: string }>(req);
    if (!body.key || !isKnownFeatureFlag(body.key)) throw new ApiError(400, "Unknown or externally-managed feature flag.");
    if (typeof body.enabled !== "boolean") throw new ApiError(400, "enabled must be true or false.");
    const reason = requireReason(body.reason);

    const before = await prisma.featureFlag.findUnique({ where: { key: body.key } });
    const def = FEATURE_FLAG_DEFS.find((d) => d.key === body.key)!;
    const updated = await prisma.featureFlag.upsert({
      where: { key: body.key },
      update: { enabled: body.enabled, updatedById: admin.id },
      create: { key: body.key, enabled: body.enabled, description: def.description, updatedById: admin.id },
    });
    invalidateFeatureFlags();
    await writeAudit({ action: "FEATURE_FLAG_CHANGED", adminId: admin.id, meta: { key: body.key, previous: before?.enabled ?? true, new: body.enabled, reason } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
