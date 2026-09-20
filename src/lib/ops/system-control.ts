import { prisma } from "@/lib/prisma";
import { setSlowQueryThreshold } from "@/lib/observability/slow-query";
import { evaluatePublicState, NEUTRAL_UNAVAILABLE_MESSAGE, type PublicState } from "@/lib/ops/system-state";
import type { SystemControl } from "@prisma/client";

// Cached accessor for the SystemControl singleton. Per-instance 15 s cache:
// a change propagates to every serverless instance within ~15 s (disclosed).

const TTL_MS = 15_000;
let cache: { value: SystemControl; at: number } | null = null;

export async function getSystemControl(): Promise<SystemControl> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await prisma.systemControl.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  cache = { value, at: Date.now() };
  setSlowQueryThreshold(value.slowQueryThresholdMs);
  return value;
}

export function invalidateSystemControl(): void {
  cache = null;
}

export async function getPublicState(): Promise<PublicState> {
  return evaluatePublicState(await getSystemControl());
}

export type EmergencySwitch =
  | "payments" | "registrations" | "profileSubmissions" | "matching" | "proposals" | "notifications" | "uploads" | "publicAccess";

const SWITCH_FIELD: Record<EmergencySwitch, keyof SystemControl> = {
  payments: "emergencyPaymentsDisabled",
  registrations: "emergencyRegistrationsDisabled",
  profileSubmissions: "emergencyProfileSubmissionsDisabled",
  matching: "emergencyMatchingDisabled",
  proposals: "emergencyProposalsDisabled",
  notifications: "emergencyNotificationsDisabled",
  uploads: "emergencyUploadsDisabled",
  publicAccess: "emergencyPublicAccessDisabled",
};

export async function isEmergencyDisabled(sw: EmergencySwitch): Promise<boolean> {
  try {
    const control = await getSystemControl();
    // EMERGENCY operational state closes every switch at once.
    return control.operationalState === "EMERGENCY" || Boolean(control[SWITCH_FIELD[sw]]);
  } catch {
    return false; // never turn a monitoring/DB hiccup into a self-inflicted outage
  }
}

export const NEUTRAL_MESSAGE_FOR_GUARDS = NEUTRAL_UNAVAILABLE_MESSAGE;

export class ServiceUnavailableError extends Error {
  status = 503;
  constructor(message = NEUTRAL_UNAVAILABLE_MESSAGE) {
    super(message);
  }
}

// Server-side guard for public/applicant actions (spec §56/§57) — throws a
// neutral 503 the route can turn into a safe response.
export async function assertSwitchOpen(sw: EmergencySwitch): Promise<void> {
  if (await isEmergencyDisabled(sw)) throw new ServiceUnavailableError();
}
