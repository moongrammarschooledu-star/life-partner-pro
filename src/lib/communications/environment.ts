import type { CommunicationEnvironment } from "@prisma/client";

// Communication environments (spec §5). Outside PRODUCTION a real SMS / WhatsApp / e-mail provider is only ever used for an
// explicitly allow-listed TEST recipient; everything else is routed to the sandbox adapter. So a staging deploy or a developer
// laptop pointed at a copy of real data can never message a real applicant by accident.

type Env = Record<string, string | undefined>;

export function currentEnvironment(env: Env = process.env): CommunicationEnvironment {
  const raw = (env.APP_ENV ?? "").toLowerCase();
  if (raw === "production" || raw === "prod") return "PRODUCTION";
  if (raw === "staging") return "STAGING";
  if (raw === "sandbox") return "SANDBOX";
  if (raw === "development" || raw === "dev" || raw === "local") return "DEVELOPMENT";
  // No explicit APP_ENV: derive from the platform. Vercel: production -> PRODUCTION, preview -> STAGING.
  const vercel = (env.VERCEL_ENV ?? "").toLowerCase();
  if (vercel === "production") return "PRODUCTION";
  if (vercel === "preview") return "STAGING";
  if (vercel === "development") return "DEVELOPMENT";
  return env.NODE_ENV === "production" ? "PRODUCTION" : "DEVELOPMENT";
}

export function isProduction(env: Env = process.env): boolean {
  return currentEnvironment(env) === "PRODUCTION";
}

function normalizeAddress(value: string): string {
  const v = value.trim().toLowerCase();
  return v.includes("@") ? v : v.replace(/[^\d+]/g, "");
}

export function testRecipients(env: Env = process.env, configured: readonly string[] = []): string[] {
  const fromEnv = (env.COMMUNICATION_TEST_RECIPIENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...fromEnv, ...configured].map(normalizeAddress);
}

export function isTestRecipient(destination: string, env: Env = process.env, configured: readonly string[] = []): boolean {
  return testRecipients(env, configured).includes(normalizeAddress(destination));
}

// A short, human-readable warning shown in the admin UI whenever the environment is not production.
export function testModeWarning(env: Env = process.env): string | null {
  const e = currentEnvironment(env);
  return e === "PRODUCTION" ? null : `${e} environment: real e-mail, SMS and WhatsApp messages are only sent to allow-listed test recipients; everything else goes to the sandbox provider.`;
}
