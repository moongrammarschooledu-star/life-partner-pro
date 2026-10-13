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
  // STEP 36 — read-only mode (optional so older callers and tests that build this object by hand keep working).
  readOnly?: boolean;
}

export interface PublicState {
  blocked: boolean;
  reason: "NONE" | "MAINTENANCE" | "EMERGENCY";
  message: string;
  operationalState: OperationalState;
  /** Read-only mode is on: pages stay viewable, but applicant, family and public WRITE requests are refused. */
  readOnly: boolean;
}

export const DEFAULT_MAINTENANCE_MESSAGE = "Life Partner Pro is temporarily undergoing maintenance. Please try again later.";
export const READ_ONLY_MESSAGE = "Life Partner Pro is in read-only mode for a short time. You can look around, but changes cannot be saved right now. Please try again later.";
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
    return { blocked: true, reason: "EMERGENCY", message: NEUTRAL_UNAVAILABLE_MESSAGE, operationalState: input.operationalState, readOnly: false };
  }
  if (input.operationalState === "MAINTENANCE" || isMaintenanceActive(input, now)) {
    return { blocked: true, reason: "MAINTENANCE", message: input.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE, operationalState: input.operationalState, readOnly: false };
  }
  return { blocked: false, reason: "NONE", message: input.readOnly ? input.maintenanceMessage?.trim() || READ_ONLY_MESSAGE : "", operationalState: input.operationalState, readOnly: Boolean(input.readOnly) };
}

// Paths that must stay reachable during maintenance/emergency so admins can
// recover and payment webhooks / cron / health probes keep working.
const EXEMPT_PREFIXES = [
  "/admin", "/api/admin", "/api/auth", "/api/health", "/api/system-state", "/api/webhooks",
  "/api/cron", "/api/internal", "/api/client-errors", "/maintenance", "/_next",
  "/status", "/api/status", // STEP 36 - the public status page must stay readable while the platform is under maintenance
];

export function isExemptFromMaintenance(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// STEP 36 — read-only mode. Writes (POST, PUT, PATCH, DELETE) from applicants, family members and the public are refused with a neutral 503 while pages stay
// viewable. Exempt: everything isExemptFromMaintenance() already exempts (admin area, auth, health, webhooks, cron), plus the sign-in and sign-out calls, so people
// can still get in and out of their accounts.
const READ_ONLY_EXTRA_EXEMPT = ["/api/my-status", "/api/family/login", "/api/family/logout"];

export function isBlockedByReadOnly(method: string, pathname: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  if (isExemptFromMaintenance(pathname)) return false;
  return !READ_ONLY_EXTRA_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}