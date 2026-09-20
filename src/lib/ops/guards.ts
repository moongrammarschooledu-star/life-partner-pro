import { NextResponse } from "next/server";
import { isEmergencyDisabled, NEUTRAL_MESSAGE_FOR_GUARDS, type EmergencySwitch } from "@/lib/ops/system-control";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";

// Route-level guard for public/applicant endpoints (spec §28/§56/§57). Returns
// a neutral 503 response when an emergency switch or feature flag is closed,
// otherwise null. Always evaluated server-side — never a UI-only control. On a
// monitoring/database hiccup both checks fail OPEN (see their implementations).
export async function blockedResponse(opts: { switches?: EmergencySwitch[]; flags?: string[] }): Promise<NextResponse | null> {
  for (const sw of opts.switches ?? []) {
    if (await isEmergencyDisabled(sw)) return unavailable();
  }
  for (const flag of opts.flags ?? []) {
    if (!(await isFeatureEnabled(flag))) return unavailable();
  }
  return null;
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: NEUTRAL_MESSAGE_FOR_GUARDS }, { status: 503, headers: { "Retry-After": "300" } });
}
