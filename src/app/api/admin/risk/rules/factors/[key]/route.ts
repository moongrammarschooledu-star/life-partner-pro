import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { gatedConfigChange } from "@/lib/risk/config-route";
import { FACTOR_DEFINITIONS, setFactor } from "@/lib/risk/config";
import type { SecurityFlagSeverity } from "@prisma/client";

const SEVERITIES: SecurityFlagSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// STEP 24 - change a risk factor's weight / enabled flag / severity. Weight is bounded (0-60), immediate-control
// status can only ever come from code (it is not editable here), sensitive traits can never be a factor, and the
// change is versioned, reasoned, re-authenticated and approval-gated exactly like a rule change.
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("risk:rules:manage");
    const { key } = await params;
    if (!Object.prototype.hasOwnProperty.call(FACTOR_DEFINITIONS, key)) throw new ApiError(404, "Unknown risk factor.");
    const body = await readJson<{ weight?: unknown; enabled?: unknown; severity?: string; reason?: unknown; stepUpToken?: string }>(req);
    if (typeof body.weight !== "number" || typeof body.enabled !== "boolean") throw new ApiError(400, "weight (number) and enabled (boolean) are required.");
    if (body.severity !== undefined && !SEVERITIES.includes(body.severity as SecurityFlagSeverity)) throw new ApiError(400, "Invalid severity.");
    return await gatedConfigChange({
      admin,
      actionType: "RISK_RULE_CHANGE",
      sourceId: `risk-factor:${key}`,
      reason: body.reason,
      stepUpToken: body.stepUpToken,
      what: "change a risk factor",
      requestedPayload: { factorKey: key, weight: body.weight, enabled: body.enabled, severity: body.severity ?? null },
      apply: async () => {
        const created = await setFactor({ factorKey: key, weight: body.weight as number, enabled: body.enabled as boolean, severity: body.severity as SecurityFlagSeverity | undefined, actorId: admin.id, reason: String(body.reason).trim().slice(0, 500) });
        return { factorKey: created.factorKey, version: created.version };
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
