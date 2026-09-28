import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { updateProvider } from "@/lib/communications/provider-service";
import { readJson } from "@/lib/communications/route-utils";

// Routing changes (activation, priority, failover, processor, environment, countries) go through the STEP 19 approval gate
// (COMMUNICATION_PROVIDER_CHANGE); the response is 202 with the approval code while it is pending. Only whitelisted fields are read.
const FIELDS = ["name", "environment", "active", "priority", "senderIdentity", "supportedCountries", "supportedLanguages", "rateLimitPerMinute", "retryMaxAttempts", "retryBaseSeconds", "processorId", "failoverAllowed"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const { id } = await params;
    const body = await readJson(req);
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f];
    const result = await updateProvider(admin, id, patch);
    return NextResponse.json(result, { status: result.approvalRequired ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
