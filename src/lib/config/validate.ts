// Pure environment validation (no I/O, no next/server-only imports) so it is
// unit-testable and shared by instrumentation, health and readiness. It only
// ever reports key NAMES and presence — never values (spec §2/§3).

export type AppEnv = "development" | "staging" | "production";

// CRITICAL = unsafe right now (env-mixing, missing hard requirement).
// BLOCKER  = required before production is declared ready, but the app can
//            keep serving (so a missing var never causes a surprise outage).
// WARNING  = should be addressed; INFO = informational.
export type ConfigSeverity = "CRITICAL" | "BLOCKER" | "WARNING" | "INFO";

export interface ConfigIssue {
  severity: ConfigSeverity;
  key: string;
  message: string;
}

type Env = Record<string, string | undefined>;

export function resolveAppEnv(env: Env): AppEnv {
  const explicit = env.APP_ENV?.toLowerCase();
  if (explicit === "development" || explicit === "staging" || explicit === "production") return explicit;
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "staging";
  return "development";
}

const KNOWN_KEYS = [
  "DATABASE_URL", "DATABASE_ENV_LABEL", "NEXTAUTH_SECRET", "AUTH_SECRET", "APP_ENV", "APP_URL",
  "BLOB_READ_WRITE_TOKEN", "STORAGE_ENV_LABEL", "BACKUP_BLOB_READ_WRITE_TOKEN", "BACKUP_ENCRYPTION_KEY",
  "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "SMS_PROVIDER_API_KEY", "WHATSAPP_ENABLED", "WHATSAPP_API_KEY",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYMENT_ENVIRONMENT",
  "CRON_SECRET", "NOTIFICATION_WEBHOOK_SECRET", "CI_EVIDENCE_TOKEN", "ALERT_WEBHOOK_URL",
  "CSP_MODE", "LOG_LEVEL", "SLOW_QUERY_THRESHOLD_MS",
] as const;

// Presence-only description, safe to show in the admin UI.
export function describeConfig(env: Env): Record<string, { present: boolean }> {
  const out: Record<string, { present: boolean }> = {};
  for (const key of KNOWN_KEYS) out[key] = { present: Boolean(env[key]?.trim()) };
  return out;
}

export function validateConfig(env: Env): { appEnv: AppEnv; issues: ConfigIssue[] } {
  const appEnv = resolveAppEnv(env);
  const prod = appEnv === "production";
  const nonDev = appEnv !== "development";
  const issues: ConfigIssue[] = [];
  const add = (severity: ConfigSeverity, key: string, message: string) => issues.push({ severity, key, message });

  // --- Core hard requirements -------------------------------------------
  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) add("CRITICAL", "DATABASE_URL", "DATABASE_URL is not set.");
  else if (!/^postgres(ql)?:\/\//i.test(dbUrl)) add("CRITICAL", "DATABASE_URL", "DATABASE_URL is not a PostgreSQL connection string.");
  else if (prod && !/sslmode=require|sslmode=verify/i.test(dbUrl)) add("WARNING", "DATABASE_URL", "Production database URL does not request TLS (sslmode=require).");

  const secret = env.NEXTAUTH_SECRET ?? env.AUTH_SECRET;
  if (!secret) add("CRITICAL", "NEXTAUTH_SECRET", "NEXTAUTH_SECRET is not set (sessions and file encryption cannot work).");
  else if (secret.length < 32) add(prod ? "CRITICAL" : "WARNING", "NEXTAUTH_SECRET", "NEXTAUTH_SECRET is shorter than 32 characters.");

  if (prod && env.NODE_ENV !== "production") add("CRITICAL", "NODE_ENV", "APP_ENV is production but NODE_ENV is not production (debug behavior may be enabled).");

  // --- Environment separation (spec §1) ----------------------------------
  for (const [key, what] of [["DATABASE_ENV_LABEL", "database"], ["STORAGE_ENV_LABEL", "storage"]] as const) {
    const label = env[key]?.trim().toLowerCase();
    if (!label) {
      if (nonDev) add("BLOCKER", key, `${key} is not set — cannot prove the ${what} belongs to the "${appEnv}" environment.`);
    } else if (label !== appEnv) {
      add("CRITICAL", key, `${key} is "${label}" but this deployment is "${appEnv}" — ${what} environments must never be mixed.`);
    }
  }

  // --- Payments -----------------------------------------------------------
  const payEnv = env.PAYMENT_ENVIRONMENT?.trim().toLowerCase();
  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  if (payEnv === "production" && !prod) add("CRITICAL", "PAYMENT_ENVIRONMENT", `PAYMENT_ENVIRONMENT is production on a "${appEnv}" deployment.`);
  if (stripeKey) {
    if (stripeKey.startsWith("sk_live_") && !prod) add("CRITICAL", "STRIPE_SECRET_KEY", `A live payment key is configured on a "${appEnv}" deployment.`);
    if (stripeKey.startsWith("sk_live_") && payEnv !== "production") add("CRITICAL", "PAYMENT_ENVIRONMENT", "A live payment key is configured but PAYMENT_ENVIRONMENT is not production.");
    if (stripeKey.startsWith("sk_test_") && prod) add("CRITICAL", "STRIPE_SECRET_KEY", "A test/sandbox payment key is configured in production.");
    if (!env.STRIPE_WEBHOOK_SECRET?.trim()) add(prod ? "BLOCKER" : "WARNING", "STRIPE_WEBHOOK_SECRET", "Payment key set but no webhook signing secret.");
  }

  // --- Endpoint secrets (fail-open today; raised loudly instead) ----------
  if (!env.CRON_SECRET?.trim()) add(prod ? "BLOCKER" : "INFO", "CRON_SECRET", "CRON_SECRET is not set — the cron endpoint is unauthenticated.");
  if (!env.NOTIFICATION_WEBHOOK_SECRET?.trim()) add(prod ? "BLOCKER" : "INFO", "NOTIFICATION_WEBHOOK_SECRET", "NOTIFICATION_WEBHOOK_SECRET is not set — the notification webhook accepts unsigned requests.");

  // --- Storage / backup ----------------------------------------------------
  if (!env.BLOB_READ_WRITE_TOKEN?.trim()) add(prod ? "BLOCKER" : "WARNING", "BLOB_READ_WRITE_TOKEN", "File storage token is not set.");
  const backupKey = env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!backupKey) add(prod ? "BLOCKER" : "INFO", "BACKUP_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY is not set — encrypted backups cannot be created.");
  else if (backupKey.length < 32) add("CRITICAL", "BACKUP_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY is shorter than 32 characters.");
  if (!env.BACKUP_BLOB_READ_WRITE_TOKEN?.trim()) add(prod ? "WARNING" : "INFO", "BACKUP_BLOB_READ_WRITE_TOKEN", "No separate backup storage token — backups share the primary storage account.");

  // --- Domain / HTTPS -------------------------------------------------------
  const appUrl = env.APP_URL?.trim();
  if (prod && !appUrl) add("BLOCKER", "APP_URL", "APP_URL (canonical production domain) is not set.");
  else if (prod && appUrl && !appUrl.startsWith("https://")) add("CRITICAL", "APP_URL", "APP_URL is not https in production.");

  // --- Operations -------------------------------------------------------------
  if (!env.CI_EVIDENCE_TOKEN?.trim()) add(prod ? "BLOCKER" : "INFO", "CI_EVIDENCE_TOKEN", "CI_EVIDENCE_TOKEN is not set — pipeline evidence cannot be recorded, so build/test/security gates cannot pass.");
  if (env.SEED_ADMIN_PASSWORD === "ChangeMe123!") add(prod ? "CRITICAL" : "WARNING", "SEED_ADMIN_PASSWORD", "Default seed admin password is still configured.");
  if (prod && (env.CSP_MODE ?? "report-only") !== "enforce") add("WARNING", "CSP_MODE", "Content-Security-Policy is report-only, not enforced.");

  // --- Communications ----------------------------------------------------------
  if (!env.SMTP_USER?.trim() || !env.SMTP_PASS?.trim()) add(prod ? "WARNING" : "INFO", "SMTP_USER", "No email provider configured (SMTP_USER / SMTP_PASS) — emails are not actually delivered.");
  if (!env.SMS_PROVIDER_API_KEY?.trim()) add("INFO", "SMS_PROVIDER_API_KEY", "No SMS provider configured — SMS is not delivered.");
  if (env.WHATSAPP_ENABLED === "true" && !env.WHATSAPP_API_KEY?.trim()) add("WARNING", "WHATSAPP_API_KEY", "WhatsApp is enabled but no API key is set.");

  // --- Secret exposure guard ---------------------------------------------------
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /(SECRET|TOKEN|PASSWORD|PRIVATE|API_?KEY)/i.test(name)) {
      add("CRITICAL", name, "A secret-looking variable is prefixed NEXT_PUBLIC_ and would be exposed to browsers.");
    }
  }

  return { appEnv, issues };
}

export function hasCritical(issues: ConfigIssue[]): boolean {
  return issues.some((i) => i.severity === "CRITICAL");
}
