// Which environment this deployment is. Pure and dependency-free, so low-level modules (feature flag evaluation) can use it without pulling in the route layer.

export type PlatformEnvironment = "DEVELOPMENT" | "STAGING" | "PRODUCTION";

type EnvMap = Record<string, string | undefined>;

export function currentEnvironment(env: EnvMap = process.env): PlatformEnvironment {
  const values = [env.APP_ENV, env.VERCEL_ENV, env.NODE_ENV].map((v) => v?.trim().toLowerCase());
  if (values.includes("production")) return "PRODUCTION";
  if (values.some((v) => v === "staging" || v === "preview")) return "STAGING";
  return "DEVELOPMENT";
}

export const ENVIRONMENT_LABEL: Record<PlatformEnvironment, string> = { DEVELOPMENT: "Development", STAGING: "Staging", PRODUCTION: "Production" };