import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { rows: [] as Array<Record<string, unknown>> };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportMessage: {
      findFirst: async ({ where }: { where: { email: string; subject: string; message: string; createdAt: { gte: Date } } }) =>
        db.rows.find((r) => r.email === where.email && r.subject === where.subject && r.message === where.message && (r.createdAt as Date) >= where.createdAt.gte) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.rows.push({ ...data, createdAt: new Date() });
        return data;
      },
    },
  },
}));
vi.mock("@/lib/ops/guards", () => ({ blockedResponse: async () => null }));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: async () => null }));

import { POST } from "@/app/api/support/route";

const good = { category: "PRIVACY", profileCode: "LPP-000123", email: "a@example.com", subject: "Deletion", message: "How do I delete my account please?", consent: true, website: "" };
const send = (body: unknown, raw?: string, headers: Record<string, string> = { origin: "https://site.test", host: "site.test" }) => POST(new Request("https://site.test/api/support", { method: "POST", headers, body: raw ?? JSON.stringify(body) }));

beforeEach(() => {
  db.rows = [];
});

describe("POST /api/support (public contact form)", () => {
  it("stores a valid enquiry with its category and the time consent was given", async () => {
    const res = await send(good);
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ email: "a@example.com", category: "PRIVACY", profileCode: "LPP-000123", subject: "Deletion" });
    expect(db.rows[0].consentAt).toBeInstanceOf(Date);
  });

  it("silently ignores a filled honeypot (a bot) without storing anything", async () => {
    const res = await send({ ...good, website: "http://spam" });
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses a missing consent, a bad e-mail, a link in the message and an unknown category", async () => {
    for (const patch of [{ consent: false }, { email: "nope" }, { message: "see https://spam.example today ok" }, { category: "SALES" }]) {
      const res = await send({ ...good, ...patch });
      expect(res.status, JSON.stringify(patch)).toBe(400);
    }
    expect(db.rows).toHaveLength(0);
  });

  it("refuses an oversized body and malformed JSON", async () => {
    expect((await send(null, "x".repeat(17 * 1024))).status).toBe(413);
    expect((await send(null, "{not json")).status).toBe(400);
    expect(db.rows).toHaveLength(0);
  });

  it("a repeated identical message within ten minutes creates one record", async () => {
    await send(good);
    const again = await send(good);
    expect(again.status).toBe(200);
    expect(db.rows).toHaveLength(1);
  });

  it("refuses a request from another site or without an Origin header, and stores nothing", async () => {
    expect((await send(good, undefined, { origin: "https://evil.test", host: "site.test" })).status).toBe(403);
    expect((await send(good, undefined, { host: "site.test" })).status).toBe(403);
    expect(db.rows).toHaveLength(0);
  });

  it("does not echo anything back to the sender", async () => {
    const res = await send(good);
    expect(await res.json()).toEqual({ ok: true });
  });
});
