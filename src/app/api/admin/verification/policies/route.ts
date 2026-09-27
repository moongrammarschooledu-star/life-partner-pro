import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { getEffectivePolicy, setPolicy, listPolicyHistory, POLICY_DEFAULTS } from "@/lib/verification/policy";

// GET returns every known policy key with its currently-effective value
// (falling back to the safe default when no VerificationPolicy row exists
// yet) plus its version history; POST sets a new version for one key.
// Consolidated from the plan's literal /policies/[key] shape — a JSON body
// avoids URL-encoding a dotted key like "reverification.intervalDays" as a
// path segment for no real benefit.
export async function GET() {
  try {
    await requireAdmin("verification:policy:view");

    const entries = await Promise.all(
      Object.entries(POLICY_DEFAULTS).map(async ([key, defaultValue]) => ({
        policyKey: key,
        value: await getEffectivePolicy(key, defaultValue),
        history: await listPolicyHistory(key),
      }))
    );

    return NextResponse.json({ items: entries });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("verification:policy:manage");
    const { policyKey, configuration } = (await req.json()) as { policyKey?: string; configuration?: unknown };

    if (!policyKey || !(policyKey in POLICY_DEFAULTS)) throw new ApiError(400, "A known policyKey is required.");
    if (configuration === undefined) throw new ApiError(400, "configuration is required.");

    const policy = await setPolicy(policyKey, configuration, admin.id);
    return NextResponse.json(policy);
  } catch (error) {
    return handleApiError(error);
  }
}
