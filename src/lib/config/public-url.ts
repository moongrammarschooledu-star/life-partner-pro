// STEP 34 §5/§42 — one place that decides which public address an e-mailed link starts with. Every link that leaves the system (invitations,
// verification, reset, notifications) must use the production domain: never a relative path (an e-mail client cannot resolve it), never
// localhost, never an http address in production.

type EnvMap = Record<string, string | undefined>;

export class PublicUrlNotConfiguredError extends Error {
  constructor() {
    super("No public address is configured (set APP_URL to the canonical https domain). A link cannot be created without it.");
  }
}

function originOf(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    return new URL(v.startsWith("http") ? v : `https://${v}`).origin;
  } catch {
    return null;
  }
}

// In order of preference. APP_URL is the documented canonical setting; the others exist because earlier steps read them.
export function publicOrigin(env: EnvMap = process.env): string {
  for (const candidate of [env.APP_URL, env.NEXT_PUBLIC_APP_URL, env.APP_BASE_URL, env.NEXTAUTH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = originOf(candidate);
    if (origin) return origin;
  }
  const production = [env.APP_ENV, env.VERCEL_ENV, env.NODE_ENV].some((v) => v?.trim().toLowerCase() === "production");
  if (production) throw new PublicUrlNotConfiguredError();
  return "http://localhost:3000"; // development only
}

export function publicUrl(path: string, env: EnvMap = process.env): string {
  const origin = publicOrigin(env);
  const origin2 = new URL(origin);
  const production = [env.APP_ENV, env.VERCEL_ENV, env.NODE_ENV].some((v) => v?.trim().toLowerCase() === "production");
  if (production && origin2.protocol !== "https:") throw new PublicUrlNotConfiguredError();
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
