import { redactString, redactValue } from "@/lib/observability/redact";

// Structured JSON logging (spec §15). One line per event so Vercel's log
// drain / any aggregator can parse it. Context is redacted before emit; the
// correlationId ties a request to its audit rows, jobs, webhooks and errors.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

const ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, CRITICAL: 50 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toUpperCase() as LogLevel;
  if (configured in ORDER) return ORDER[configured];
  // Production avoids DEBUG noise by default (spec §15).
  const prod = process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
  return prod ? ORDER.INFO : ORDER.DEBUG;
}

export interface LogContext {
  correlationId?: string;
  route?: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redactString(message, 300),
    env: process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "development",
    version: process.env.APP_VERSION,
    ...(redactValue(context) as Record<string, unknown>),
  });
  if (ORDER[level] >= ORDER.ERROR) console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => log("DEBUG", message, context),
  info: (message: string, context?: LogContext) => log("INFO", message, context),
  warn: (message: string, context?: LogContext) => log("WARN", message, context),
  error: (message: string, context?: LogContext) => log("ERROR", message, context),
  critical: (message: string, context?: LogContext) => log("CRITICAL", message, context),
};

// Lightweight "trace": timed span written as a correlated log line. Not a
// distributed-tracing backend (none is configured) — disclosed in the report.
export async function withSpan<T>(name: string, context: LogContext, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    log("DEBUG", `span:${name}`, { ...context, durationMs: Date.now() - start });
  }
}
