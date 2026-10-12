// STEP 34 §39 — production must never contain demo applicants, a known default administrator password or any other development data.
// prisma/seed.ts creates exactly that (fictional applicants and an administrator whose password may default to a published value), so it
// refuses to run unless the target is clearly a development database. Pure function: it only reads the values it is given.

type EnvMap = Record<string, string | undefined>;

export class SeedRefusedError extends Error {}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i;

function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function assertSeedAllowed(env: EnvMap = process.env): void {
  const environments = [env.APP_ENV, env.VERCEL_ENV, env.NODE_ENV].map((v) => v?.trim().toLowerCase()).filter(Boolean);
  if (environments.includes("production")) {
    throw new SeedRefusedError("Refusing to seed: this is a production environment. Production never gets demo data.");
  }
  const label = env.DATABASE_ENV_LABEL?.trim().toLowerCase();
  if (label === "production" || label === "staging") {
    throw new SeedRefusedError(`Refusing to seed: DATABASE_ENV_LABEL is "${label}". Demo data is only for a development database.`);
  }
  // A development target is either labelled as one or lives on this machine. An unlabelled remote database is treated as unsafe,
  // because a copy of the production connection string in a local .env is the usual way demo data reaches production.
  const host = databaseHost(env.DATABASE_URL);
  const local = host !== null && LOCAL_HOST.test(host);
  if (label !== "development" && !local) {
    throw new SeedRefusedError("Refusing to seed: the database is not clearly a development one. Set DATABASE_ENV_LABEL=development for a dedicated development database, or point DATABASE_URL at localhost.");
  }
  if (env.ALLOW_DEMO_SEED !== "true") {
    throw new SeedRefusedError("Refusing to seed: set ALLOW_DEMO_SEED=true to confirm that demo applicants and a demo administrator may be created.");
  }
}
