import { createHash } from "crypto";
import type { ErrorCategory, ErrorSeverity } from "@prisma/client";
import { redactString } from "@/lib/observability/redact";

// Pure error classification (spec §14). Maps a thrown error + route (+ HTTP
// status when known) to one of the 14 categories, a severity and a service.

export interface Classification {
  category: ErrorCategory;
  severity: ErrorSeverity;
  service: string;
}

const ROUTE_CATEGORY: Array<[RegExp, ErrorCategory]> = [
  [/^\/api\/webhooks\/payments/, "WEBHOOK_ERROR"],
  [/^\/api\/webhooks/, "WEBHOOK_ERROR"],
  [/finance|my-billing|packages/, "PAYMENT_ERROR"],
  [/verify|verification|verification-documents/, "VERIFICATION_ERROR"],
  [/\/api\/(admin\/)?(cases|support)|my-cases/, "SUPPORT_ERROR"],
  [/matching|matches|\/matches/, "MATCHING_ERROR"],
  [/proposals|my-proposals/, "PROPOSAL_ERROR"],
  [/notification|communication-center|my-notifications|cron/, "NOTIFICATION_ERROR"],
  [/admin\/auth|\/api\/auth|reauth/, "AUTH_ERROR"],
];

export function classifyError(params: { error: unknown; route?: string; status?: number; service?: string }): Classification {
  const { error, route = "", status } = params;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");

  let category: ErrorCategory = "SYSTEM_ERROR";
  if (status === 401) category = "AUTH_ERROR";
  else if (status === 403) category = "AUTHORIZATION_ERROR";
  else if (status === 400 || status === 422) category = "VALIDATION_ERROR";
  else if (status === 429) category = "SECURITY_ERROR";
  else if (/^PrismaClient|Prisma/.test(name) || /prisma|database|connection pool|P\d{4}/i.test(message)) category = "DATABASE_ERROR";
  else if (/blob|storage|upload/i.test(message) || /storage|evidence|photo/.test(route)) category = "STORAGE_ERROR";
  else {
    for (const [re, cat] of ROUTE_CATEGORY) {
      if (re.test(route)) {
        category = cat;
        break;
      }
    }
  }

  let severity: ErrorSeverity = "MEDIUM";
  if (status === 401 || status === 400 || status === 422) severity = "LOW";
  else if (status === 403 || status === 429) severity = "MEDIUM";
  else if (category === "DATABASE_ERROR" || category === "PAYMENT_ERROR" || category === "STORAGE_ERROR" || category === "WEBHOOK_ERROR") severity = "HIGH";

  const service = params.service ?? (/^\/api\/webhooks/.test(route) ? "WEBHOOK" : /cron/.test(route) ? "CRON" : "API");
  return { category, severity, service };
}

// Stable per-error-shape identifier: ids/numbers/uuids stripped so the same
// failure on different records collapses into one row with a count.
export function normalizeMessage(message: string): string {
  return redactString(message, 300)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\bc[a-z0-9]{24}\b/g, "<id>")
    .replace(/\d+/g, "<n>");
}

export function fingerprintError(category: ErrorCategory, route: string | undefined, message: string): string {
  return createHash("sha256").update(`${category}|${route ?? "-"}|${normalizeMessage(message)}`).digest("hex").slice(0, 32);
}
