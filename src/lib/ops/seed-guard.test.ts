import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { assertSeedAllowed, SeedRefusedError } from "@/lib/ops/seed-guard";

// STEP 34 §39 — demo data must never reach production.
const dev = { DATABASE_ENV_LABEL: "development", DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/db", ALLOW_DEMO_SEED: "true" };

describe("assertSeedAllowed", () => {
  it("allows a labelled development database that was explicitly confirmed", () => {
    expect(() => assertSeedAllowed(dev)).not.toThrow();
  });

  it("allows a database on this machine without a label", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@localhost:5432/lpp", ALLOW_DEMO_SEED: "true" })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/lpp", ALLOW_DEMO_SEED: "true" })).not.toThrow();
  });

  it.each([{ APP_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production" }])("refuses in a production environment (%o), even when everything else is set", (extra) => {
    expect(() => assertSeedAllowed({ ...dev, ...extra })).toThrow(SeedRefusedError);
  });

  it.each(["production", "staging"])("refuses a database labelled %s", (label) => {
    expect(() => assertSeedAllowed({ ...dev, DATABASE_ENV_LABEL: label })).toThrow(/DATABASE_ENV_LABEL/);
  });

  it("refuses an unlabelled remote database (a production URL copied into a local .env)", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/db", ALLOW_DEMO_SEED: "true" })).toThrow(/not clearly a development one/);
  });

  it("refuses without the explicit confirmation", () => {
    expect(() => assertSeedAllowed({ DATABASE_ENV_LABEL: "development", DATABASE_URL: "postgresql://u:p@ep-x.neon.tech/db" })).toThrow(/ALLOW_DEMO_SEED/);
  });

  it("does not let a host that merely contains 'localhost' pass", () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: "postgresql://u:p@localhost.evil.example/db", ALLOW_DEMO_SEED: "true" })).toThrow(SeedRefusedError);
  });
});

describe("prisma/seed.ts", () => {
  it("calls the guard before it creates anything", () => {
    const src = readFileSync(join(process.cwd(), "prisma", "seed.ts"), "utf8");
    const main = src.slice(src.indexOf("async function main()"));
    expect(main.indexOf("assertSeedAllowed()")).toBeGreaterThan(-1);
    expect(main.indexOf("assertSeedAllowed()")).toBeLessThan(main.indexOf("seedAdmins()"));
  });
});
