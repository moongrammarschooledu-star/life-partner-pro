import { rateLimit } from "@/lib/rate-limit";

const MAX_EXPORTS_PER_HOUR = 20;

// Spec §30's explicit rate-limiting requirement for exports — reuses the
// existing in-memory token bucket rather than inventing a second mechanism.
export function checkExportRateLimit(adminId: string): boolean {
  return rateLimit(`report-export:${adminId}`, MAX_EXPORTS_PER_HOUR, 60 * 60 * 1000);
}
