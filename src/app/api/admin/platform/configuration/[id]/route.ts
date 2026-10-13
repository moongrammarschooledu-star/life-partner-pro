import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getConfigChange } from "@/lib/platform/config-change";
import { diffConfig } from "@/lib/platform/config-diff";

export const dynamic = "force-dynamic";

// One change with its before/after and a field-by-field comparison.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("platform:configuration:view");
    const { id } = await params;
    const change = await getConfigChange(id);
    if (!change) throw new ApiError(404, "Not found.");
    return NextResponse.json({ change, diff: diffConfig(change.key, change.before, change.after) });
  } catch (error) {
    return handleApiError(error);
  }
}