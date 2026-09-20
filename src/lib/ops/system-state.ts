import type { MaintenanceMode, OperationalState } from "@prisma/client";

// Pure decision logic for maintenance / emergency behavior (spec §10/§27/§56).
// No I/O so it is unit-tested and shared by the proxy state endpoint, the
// public layout and API guards.

export interface StateInput {
  operationalState: OperationalState;
  maintenanceMode: MaintenanceMode;
  maintenanceStartsAt: Date | null;
  maintenanceEndsAt: Date | null;
  maintenanceMessage: string | null;
  emergencyPublicAccessDisabled: boolean;
}

export interface PublicState {
  blocked: boolean;
  reason: "NONE" | "MAINTENANCE" | "EMERGENCY";
  message: string;
  operationalState: OperationalState;
}

export const DEFAULT_MAINTENANCE_MESSAGE = "Life Partner Pro is temporarily undergoing maintenance. Please try again later.";
export const NEUTRAL_UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again later.";

export function isMaintenanceActive(input: Pick<StateInput, "maintenanceMode" | "maintenanceStartsAt" | "maintenanceEndsAt">, now: Date): boolean {
  if (input.maintenanceMode === "ON") return true;
  if (input.maintenanceMode === "SCHEDULED") {
    const starts = input.maintenanceStartsAt?.getTime();
    const ends = input.maintenanceEndsAt?.getTime();
    if (starts == null) return false;
    return now.getTime() >= starts && (ends == null || now.getTime() < ends);
  }
  return false;
}

export function evaluatePublicState(input: StateInput, now: Date = new Date()): PublicState {
  if (input.emergencyPublicAccessDisabled || input.operationalState === "EMERGENCY") {
    return { blocked: true, reason: "EMERGENCY", message: NEUTRAL_UNAVAILABLE_MESSAGE, operationalState: input.operationalState };
  }
  if (input.operationalState === "MAINTENANCE" || isMaintenanceActive(input, now)) {
    return { blocked: true, reason: "MAINTENANCE", message: input.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE, operationalState: input.operationalState };
  }
  return { blocked: false, reason: "NONE", message: "", operationalState: input.operationalState };
}

// Paths that must stay reachable during maintenance/emergency so admins can
// recover and payment webhooks / cron / health probes keep working.
const EXEMPT_PREFIXES = [
  "/admin", "/api/admin", "/api/auth", "/api/health", "/api/system-state", "/api/webhooks",
  "/api/cron", "/api/internal", "/api/client-errors", "/maintenance", "/_next",
];

export function isExemptFromMaintenance(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
