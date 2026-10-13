// One status vocabulary for every provider (STEP 36 §13), and the safe mapping from each source's own words. Pure.

export const PROVIDER_STATUSES = ["CONNECTED", "HEALTHY", "DEGRADED", "UNAVAILABLE", "DISABLED", "NOT_CONFIGURED"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const TEST_OUTCOMES = ["SUCCESS", "FAILED", "TIMEOUT", "NOT_CONFIGURED"] as const;
export type TestOutcome = (typeof TEST_OUTCOMES)[number];

/** From the platform health report (ops/health.ts). */
export function fromHealthCheck(status: "ok" | "degraded" | "down" | "not_configured" | "unknown"): ProviderStatus {
  switch (status) {
    case "ok":
      return "HEALTHY";
    case "degraded":
      return "DEGRADED";
    case "down":
      return "UNAVAILABLE";
    case "not_configured":
      return "NOT_CONFIGURED";
    default:
      return "CONNECTED"; // present but never measured
  }
}

/** From a communications provider row. `configured` = every credential name is present in the environment (names only; values are never read here). */
export function fromCommunicationProvider(row: { active: boolean; healthStatus: string }, configured: boolean): ProviderStatus {
  if (!configured) return "NOT_CONFIGURED";
  if (!row.active) return "DISABLED";
  switch (row.healthStatus) {
    case "HEALTHY":
      return "HEALTHY";
    case "DEGRADED":
      return "DEGRADED";
    case "DOWN":
      return "UNAVAILABLE";
    default:
      return "CONNECTED";
  }
}

export function fromMarketingConnection(status: "NOT_CONFIGURED" | "CONNECTED" | "ERROR" | "DISABLED"): ProviderStatus {
  return status === "ERROR" ? "UNAVAILABLE" : status;
}

export function outcomeToStatus(outcome: TestOutcome): ProviderStatus {
  switch (outcome) {
    case "SUCCESS":
      return "HEALTHY";
    case "FAILED":
      return "UNAVAILABLE";
    case "TIMEOUT":
      return "DEGRADED";
    default:
      return "NOT_CONFIGURED";
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  authentication: "Authentication",
  database: "Database",
  storage: "File storage",
  email: "E-mail",
  sms: "SMS",
  whatsapp: "WhatsApp",
  in_app: "In-app notifications",
  payments: "Payments",
  ai: "AI",
  marketing: "Marketing",
  monitoring: "Monitoring",
  analytics: "Analytics",
};

/** A diagnostic string that is safe to store and show: no line breaks, no long tokens, short. */
export function safeDiagnostic(text: string | undefined | null): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const noTokens = flat.replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, "[hidden]");
  return noTokens.slice(0, 200);
}
