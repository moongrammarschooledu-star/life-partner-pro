import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// STEP 34 §45 - the go-live gate end to end against an in-memory database: the state machine, maker-checker, automatic block and history.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ state: null as Row | null, events: [] as Row[], audit: [] as Row[], verdict: "READY" as "READY" | "NOT READY", commit: "abc1234" as string | null }));

vi.mock("@/lib/prisma", () => {
  const goLiveState = {
    upsert: async ({ create }: { create: Row }) => (db.state ??= { readyById: null, readyAt: null, approvedById: null, approvedAt: null, liveById: null, liveAt: null, commitSha: null, reason: null, ...create }),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!db.state || db.state.id !== where.id || db.state.status !== where.status) return { count: 0 };
      Object.assign(db.state, data);
      return { count: 1 };
    },
  };
  const goLiveEvent = {
    create: async ({ data }: { data: Row }) => { db.events.push({ id: `e${db.events.length}`, createdAt: new Date(), ...data }); return data; },
    findMany: async () => [...db.events].reverse(),
  };
  const client = { goLiveState, goLiveEvent, adminUser: { findMany: async () => [{ id: "maker", name: "Maker" }, { id: "checker", name: "Checker" }] }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ goLiveState, goLiveEvent }) };
  return { prisma: client };
});
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: Row) => { db.audit.push(a); } }));
vi.mock("@/lib/config/server-config", () => ({ getServerConfig: () => ({ commitSha: db.commit }) }));
vi.mock("@/lib/ops/readiness", () => ({
  getReadinessReport: async () => ({ verdict: db.verdict, unresolved: db.verdict === "READY" ? [] : ["Backup is stale"], gates: [] }),
}));

import { actOnGoLive, getGoLiveView, reconcileGoLive } from "@/lib/ops/go-live";

beforeEach(() => { db.state = null; db.events = []; db.audit = []; db.verdict = "READY"; db.commit = "abc1234"; });

describe("go-live gate", () => {
  it("starts blocked", async () => {
    expect((await getGoLiveView()).status).toBe("GO_LIVE_BLOCKED");
  });

  it("walks BLOCKED -> READY -> APPROVED -> LIVE with two different administrators and records every step", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    expect(db.state?.status).toBe("GO_LIVE_READY");
    await actOnGoLive({ action: "APPROVE", actorId: "checker" });
    expect(db.state?.status).toBe("GO_LIVE_APPROVED");
    const view = await actOnGoLive({ action: "GO_LIVE", actorId: "checker" });
    expect(view.status).toBe("LIVE");
    expect(db.events.map((e) => e.action)).toEqual(["MARK_READY", "APPROVE", "GO_LIVE"]);
    expect(db.audit.map((a) => a.action)).toEqual(["GO_LIVE_MARKED_READY", "GO_LIVE_APPROVED", "GO_LIVE_RECORDED_LIVE"]);
  });

  it("refuses self-approval", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    await expect(actOnGoLive({ action: "APPROVE", actorId: "maker" })).rejects.toThrow(/different administrator/);
    expect(db.state?.status).toBe("GO_LIVE_READY");
  });

  it("refuses to mark ready while a gate fails, and changes nothing", async () => {
    db.verdict = "NOT READY";
    await expect(actOnGoLive({ action: "MARK_READY", actorId: "maker" })).rejects.toThrow(/gate/);
    expect(db.state?.status).toBe("GO_LIVE_BLOCKED");
    expect(db.events).toHaveLength(0);
  });

  it("drops READY back to BLOCKED by itself when a gate starts failing, with a system event", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    db.verdict = "NOT READY";
    const { row } = await reconcileGoLive();
    expect(row.status).toBe("GO_LIVE_BLOCKED");
    expect(row.readyById).toBeNull();
    expect(db.events.at(-1)).toMatchObject({ action: "AUTO_BLOCK", actorId: null });
    // and approval can no longer happen
    await expect(actOnGoLive({ action: "APPROVE", actorId: "checker" })).rejects.toThrow();
  });

  it("drops APPROVED back to BLOCKED when a different build starts running", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    await actOnGoLive({ action: "APPROVE", actorId: "checker" });
    db.commit = "def5678";
    expect((await reconcileGoLive()).row.status).toBe("GO_LIVE_BLOCKED");
  });

  it("never changes LIVE on its own but reports drift", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    await actOnGoLive({ action: "APPROVE", actorId: "checker" });
    await actOnGoLive({ action: "GO_LIVE", actorId: "checker" });
    db.verdict = "NOT READY";
    db.commit = "def5678";
    const view = await getGoLiveView();
    expect(view.status).toBe("LIVE");
    expect(view.drift.length).toBeGreaterThan(0);
  });

  it("block needs a reason and clears the approvals", async () => {
    await actOnGoLive({ action: "MARK_READY", actorId: "maker" });
    await expect(actOnGoLive({ action: "BLOCK", actorId: "maker", reason: "" })).rejects.toThrow(/reason/);
    await actOnGoLive({ action: "BLOCK", actorId: "maker", reason: "Found a problem in the backup" });
    expect(db.state).toMatchObject({ status: "GO_LIVE_BLOCKED", readyById: null, approvedById: null, commitSha: null });
  });

  it("cannot jump straight to live", async () => {
    await expect(actOnGoLive({ action: "GO_LIVE", actorId: "maker" })).rejects.toThrow(/approved/);
  });
});

describe("go-live routes", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  it("changing the status needs the go-live permission and a fresh password", () => {
    const src = read("src/app/api/admin/go-live/route.ts");
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post).toContain('requireAdmin("golive:manage")');
    expect(post).toContain("requireReauth(");
    expect(src.slice(0, src.indexOf("export async function POST"))).toContain('requireAdmin("readiness:view")');
  });
  it("the deployment summary is read-only and permission-gated", () => {
    const src = read("src/app/api/admin/deployment/route.ts");
    expect(src).toContain('requireAdmin("readiness:view")');
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
  it("the deployment summary reads no secret setting", () => {
    expect(read("src/lib/ops/deployment-info.ts")).not.toMatch(/process\.env\.[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD|URL)/);
  });
});
