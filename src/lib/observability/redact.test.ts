import { describe, it, expect } from "vitest";
import { redactString, redactValue } from "./redact";
import { classifyError, fingerprintError, normalizeMessage } from "./classify";
import { parseQuery } from "./slow-query";

describe("redactString", () => {
  it("removes connection strings, bearer tokens, JWTs, provider keys, emails and long numbers", () => {
    const text = "db postgres://user:pw@host/db and Bearer abc.def-123 mail me a.b@example.com call +92 300 1234567 key sk_live_abcdefghijkl";
    const out = redactString(text);
    expect(out).not.toContain("pw@host");
    expect(out).not.toContain("abc.def-123");
    expect(out).not.toContain("a.b@example.com");
    expect(out).not.toContain("1234567");
    expect(out).not.toContain("sk_live_abcdefghijkl");
  });
  it("truncates long strings", () => {
    expect(redactString("a".repeat(2000), 100).length).toBeLessThanOrEqual(101);
  });
});

describe("redactValue", () => {
  it("redacts by key name, recursively", () => {
    const out = redactValue({ user: { password: "hunter2", otp: "123456", note: "ok" }, authorization: "Bearer x", count: 3 }) as Record<string, unknown>;
    expect((out.user as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((out.user as Record<string, unknown>).otp).toBe("[REDACTED]");
    expect((out.user as Record<string, unknown>).note).toBe("ok");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.count).toBe(3);
  });
  it("bounds recursion depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: "x" } } } } } };
    expect(JSON.stringify(redactValue(deep))).toContain("[TRUNCATED]");
  });
});

describe("classifyError", () => {
  it("maps HTTP statuses to categories", () => {
    expect(classifyError({ error: new Error("x"), status: 401 }).category).toBe("AUTH_ERROR");
    expect(classifyError({ error: new Error("x"), status: 403 }).category).toBe("AUTHORIZATION_ERROR");
    expect(classifyError({ error: new Error("x"), status: 400 }).category).toBe("VALIDATION_ERROR");
  });
  it("maps routes and database errors", () => {
    expect(classifyError({ error: new Error("boom"), route: "/api/admin/finance-center/payments" }).category).toBe("PAYMENT_ERROR");
    expect(classifyError({ error: new Error("boom"), route: "/api/webhooks/payments/stripe" }).category).toBe("WEBHOOK_ERROR");
    const dbErr = new Error("Invalid `prisma.profile.findMany()` invocation");
    expect(classifyError({ error: dbErr, route: "/api/admin/profiles" }).category).toBe("DATABASE_ERROR");
    expect(classifyError({ error: new Error("boom"), route: "/api/unknown" }).category).toBe("SYSTEM_ERROR");
  });
  it("marks database/payment failures HIGH severity", () => {
    expect(classifyError({ error: new Error("prisma failed") }).severity).toBe("HIGH");
  });
});

describe("fingerprintError", () => {
  it("collapses ids and numbers so the same failure shape is one row", () => {
    const a = fingerprintError("SYSTEM_ERROR", "/x", "Profile 12345 not found for c1234567890123456789012345");
    const b = fingerprintError("SYSTEM_ERROR", "/x", "Profile 99 not found for c9999999999999999999999999");
    expect(a).toBe(b);
    expect(normalizeMessage("Row 5")).toBe("Row <n>");
  });
  it("differs across categories and routes", () => {
    expect(fingerprintError("SYSTEM_ERROR", "/a", "x")).not.toBe(fingerprintError("SYSTEM_ERROR", "/b", "x"));
  });
});

describe("parseQuery (slow-query attribution)", () => {
  it("extracts operation and table, never the parameters", () => {
    expect(parseQuery('SELECT "public"."Profile"."id" FROM "public"."Profile" WHERE "x" = $1')).toEqual({ operation: "SELECT", table: "Profile" });
    expect(parseQuery('UPDATE "public"."Payment" SET "status" = $1')).toEqual({ operation: "UPDATE", table: "Payment" });
    expect(parseQuery('INSERT INTO "public"."AuditLog" ("id") VALUES ($1)')).toEqual({ operation: "INSERT", table: "AuditLog" });
    expect(parseQuery("BEGIN")).toEqual({ operation: "BEGIN", table: "-" });
  });
});
