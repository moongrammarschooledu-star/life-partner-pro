import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/observability/logger";
import { redactString } from "@/lib/observability/redact";
import { classifyError, fingerprintError } from "@/lib/observability/classify";
import { bumpCounter } from "@/lib/observability/metrics";
import type { ErrorCategory, ErrorSeverity } from "@prisma/client";

// Centralised, never-throwing error capture (spec §13). Writes ONE deduped
// row per (fingerprint, environment) with an occurrence count. Only the
// redacted, truncated message is stored — no stack, no request body, no
// user data. A per-instance throttle stops a failure storm from hammering
// the database with writes.

const recentlyWritten = new Map<string, number>();
const THROTTLE_MS = 5_000;

export interface CaptureParams {
  error: unknown;
  route?: string;
  status?: number;
  service?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  correlationId?: string;
}

function environment(): string {
  return process.env.APP_ENV ?? (process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "staging" : "development");
}

export async function captureError(params: CaptureParams): Promise<void> {
  try {
    const classification = classifyError({ error: params.error, route: params.route, status: params.status, service: params.service });
    const category = params.category ?? classification.category;
    const severity = params.severity ?? classification.severity;
    const rawMessage = params.error instanceof Error ? params.error.message : String(params.error ?? "Unknown error");
    const message = redactString(rawMessage, 300);
    const fingerprint = fingerprintError(category, params.route, rawMessage);
    const env = environment();

    logger.error("captured_error", { category, severity, route: params.route, correlationId: params.correlationId, errorName: params.error instanceof Error ? params.error.name : undefined, message });

    // Hourly counters feed alert rules (before the write throttle, so a storm is still counted).
    if (category === "AUTH_ERROR" || category === "AUTHORIZATION_ERROR") void bumpCounter("security:violations");
    else if (category === "STORAGE_ERROR") void bumpCounter("errors:storage");
    else if (category !== "VALIDATION_ERROR") void bumpCounter("errors:server");

    const now = Date.now();
    const key = `${fingerprint}:${env}`;
    const last = recentlyWritten.get(key);
    if (last && now - last < THROTTLE_MS) return;
    recentlyWritten.set(key, now);
    if (recentlyWritten.size > 500) recentlyWritten.clear();

    await prisma.errorEvent.upsert({
      where: { fingerprint_environment: { fingerprint, environment: env } },
      create: {
        fingerprint,
        category,
        severity,
        service: classification.service,
        route: params.route ?? null,
        message,
        environment: env,
        appVersion: process.env.APP_VERSION ?? null,
        correlationId: params.correlationId ?? null,
      },
      update: {
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
        correlationId: params.correlationId ?? undefined,
        // A resolved error that recurs is re-opened.
        status: "NEW",
        resolvedAt: null,
        resolvedById: null,
      },
    });
  } catch (captureFailure) {
    // Never let monitoring break the request path.
    logger.warn("error_capture_failed", { reason: captureFailure instanceof Error ? captureFailure.message : "unknown" });
  }
}
