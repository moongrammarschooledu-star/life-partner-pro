import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { setPolicy, type PolicyKindKey } from "@/lib/communications/policy-config";
import { readJson, str } from "@/lib/communications/route-utils";

const KINDS: PolicyKindKey[] = ["FREQUENCY", "QUIET_HOURS", "JURISDICTION_DEFAULTS", "ENVIRONMENT"];

// Every change creates a NEW policy version (the old one is kept as SUPERSEDED), needs a reason, is validated strictly and audited.
export async function PUT(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const { kind } = await params;
    const key = kind.toUpperCase().replace(/-/g, "_") as PolicyKindKey;
    if (!KINDS.includes(key)) throw new ApiError(404, "Unknown policy.");
    const body = await readJson(req);
    const created = await setPolicy({ kind: key, config: body.configuration, actorId: admin.id, reason: str(body.reason, "reason", { max: 300 }) });
    return NextResponse.json({ kind: key, version: created.version });
  } catch (error) {
    return handleApiError(error);
  }
}
