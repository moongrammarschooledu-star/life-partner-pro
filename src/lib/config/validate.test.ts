import { describe, it, expect } from "vitest";
import { validateConfig, resolveAppEnv, describeConfig, hasCritical } from "./validate";

const goodProd = {
  VERCEL_ENV: "production",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@host/db?sslmode=require",
  NEXTAUTH_SECRET: "x".repeat(40),
  DATABASE_ENV_LABEL: "production",
  STORAGE_ENV_LABEL: "production",
  BLOB_READ_WRITE_TOKEN: "blob",
  CRON_SECRET: "cron",
  NOTIFICATION_WEBHOOK_SECRET: "hook",
  BACKUP_ENCRYPTION_KEY: "k".repeat(40),
  APP_URL: "https://example.com",
  CI_EVIDENCE_TOKEN: "ci",
  CSP_MODE: "enforce",
  SMTP_USER: "mail@example.com", SMTP_PASS: "app-pass",
};

describe("resolveAppEnv", () => {
  it("prefers APP_ENV, then VERCEL_ENV, then development", () => {
    expect(resolveAppEnv({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe("staging");
    expect(resolveAppEnv({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ VERCEL_ENV: "preview" })).toBe("staging");
    expect(resolveAppEnv({})).toBe("development");
  });
});

describe("validateConfig", () => {
  it("reports no critical/blocker issues for a fully configured production environment", () => {
    const { issues } = validateConfig(goodProd);
    expect(issues.filter((i) => i.severity === "CRITICAL" || i.severity === "BLOCKER")).toEqual([]);
  });

  it("flags missing DATABASE_URL and NEXTAUTH_SECRET as CRITICAL", () => {
    const { issues } = validateConfig({});
    expect(issues.find((i) => i.key === "DATABASE_URL")?.severity).toBe("CRITICAL");
    expect(issues.find((i) => i.key === "NEXTAUTH_SECRET")?.severity).toBe("CRITICAL");
    expect(hasCritical(issues)).toBe(true);
  });

  it("treats a database label that does not match the environment as CRITICAL (env mixing)", () => {
    const { issues } = validateConfig({ ...goodProd, DATABASE_ENV_LABEL: "staging" });
    expect(issues.find((i) => i.key === "DATABASE_ENV_LABEL")?.severity).toBe("CRITICAL");
  });

  it("treats a MISSING label in production as a BLOCKER (not a runtime outage)", () => {
    const { DATABASE_ENV_LABEL, ...rest } = goodProd;
    void DATABASE_ENV_LABEL;
    const { issues } = validateConfig(rest);
    expect(issues.find((i) => i.key === "DATABASE_ENV_LABEL")?.severity).toBe("BLOCKER");
  });

  it("rejects a live payment key outside production and a test key inside production", () => {
    const live = validateConfig({ ...goodProd, VERCEL_ENV: "preview", STRIPE_SECRET_KEY: "sk_live_abcdefgh", PAYMENT_ENVIRONMENT: "production" });
    expect(live.issues.some((i) => i.severity === "CRITICAL" && i.key === "STRIPE_SECRET_KEY")).toBe(true);
    const test = validateConfig({ ...goodProd, STRIPE_SECRET_KEY: "sk_test_abcdefgh", PAYMENT_ENVIRONMENT: "production" });
    expect(test.issues.some((i) => i.severity === "CRITICAL" && i.key === "STRIPE_SECRET_KEY")).toBe(true);
  });

  it("raises CRON_SECRET / NOTIFICATION_WEBHOOK_SECRET as BLOCKERs in production only", () => {
    const { CRON_SECRET, NOTIFICATION_WEBHOOK_SECRET, ...rest } = goodProd;
    void CRON_SECRET; void NOTIFICATION_WEBHOOK_SECRET;
    expect(validateConfig(rest).issues.filter((i) => i.severity === "BLOCKER").map((i) => i.key)).toEqual(expect.arrayContaining(["CRON_SECRET", "NOTIFICATION_WEBHOOK_SECRET"]));
    expect(validateConfig({ ...rest, VERCEL_ENV: undefined, NODE_ENV: undefined }).issues.some((i) => i.severity === "BLOCKER" && i.key === "CRON_SECRET")).toBe(false);
  });

  it("flags secret-looking NEXT_PUBLIC_ variables as CRITICAL exposure", () => {
    const { issues } = validateConfig({ ...goodProd, NEXT_PUBLIC_API_SECRET: "oops" });
    expect(issues.some((i) => i.severity === "CRITICAL" && i.key === "NEXT_PUBLIC_API_SECRET")).toBe(true);
  });

  it("requires https APP_URL in production", () => {
    expect(validateConfig({ ...goodProd, APP_URL: "http://example.com" }).issues.some((i) => i.key === "APP_URL" && i.severity === "CRITICAL")).toBe(true);
  });
});

describe("describeConfig", () => {
  it("reports presence only — never values", () => {
    const out = describeConfig({ DATABASE_URL: "postgresql://secret", CRON_SECRET: "" });
    expect(out.DATABASE_URL).toEqual({ present: true });
    expect(out.CRON_SECRET).toEqual({ present: false });
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
