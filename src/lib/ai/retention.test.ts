import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; where: Record<string, unknown> }>,
  raw: [] as Array<{ sql: string; values: unknown[] }>,
  fail: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiResult: { deleteMany: async ({ where }: { where: Record<string, unknown> }) => { if (h.fail) throw new Error("relation does not exist"); h.calls.push({ model: "aiResult", where }); return { count: 3 }; } },
    aiRequest: { deleteMany: async ({ where }: { where: Record<string, unknown> }) => { h.calls.push({ model: "aiRequest", where }); return { count: 2 }; } },
    aiSafetyEvent: { deleteMany: async ({ where }: { where: Record<string, unknown> }) => { h.calls.push({ model: "aiSafetyEvent", where }); return { count: 1 }; } },
    $executeRaw: async (q: { sql: string; values: unknown[] }) => { h.raw.push({ sql: q.sql, values: q.values }); return 4; },
  },
}));
vi.mock("@/lib/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { purgeExpiredAiResults, eraseAiDataForProfile, safeSweepAiData, safeEraseAiDataForProfile, METADATA_RETENTION_DAYS } from "@/lib/ai/retention";

beforeEach(() => {
  h.calls.length = 0;
  h.raw.length = 0;
  h.fail = false;
});

describe("AI retention (spec §29/§53/§67)", () => {
  it("purges expired results and old metadata using the operational window", async () => {
    const now = new Date("2026-09-21T00:00:00Z");
    const r = await purgeExpiredAiResults(now);
    expect(r).toEqual({ results: 3, requests: 2, safetyEvents: 1 });
    expect(h.calls[0]).toMatchObject({ model: "aiResult", where: { expiresAt: { lte: now } } });
    const cutoff = (h.calls[1].where.createdAt as { lt: Date }).lt;
    expect(Math.round((now.getTime() - cutoff.getTime()) / 86_400_000)).toBe(METADATA_RETENTION_DAYS);
  });

  it("erases AI results for a member and strips the member id from request metadata", async () => {
    const r = await eraseAiDataForProfile("profile-123");
    expect(h.calls[0]).toMatchObject({ model: "aiResult", where: { profileIds: { has: "profile-123" } } });
    expect(h.raw[0].sql).toMatch(/array_remove/);
    expect(h.raw[0].values).toContain("profile-123");
    expect(r).toEqual({ results: 3, requests: 4 });
  });

  it("never lets an AI cleanup failure break the retention sweep or account deletion", async () => {
    h.fail = true;
    await expect(safeSweepAiData()).resolves.toBeUndefined();
    await expect(safeEraseAiDataForProfile("p")).resolves.toBeUndefined();
  });
});
