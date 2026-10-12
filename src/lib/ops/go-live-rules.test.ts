import { describe, it, expect } from "vitest";
import { decide, autoBlockReason, liveDrift, isGoLiveStatus, type GoLiveSnapshot, type GateFacts } from "@/lib/ops/go-live-rules";

const pass: GateFacts = { verdict: "READY", unresolved: [], currentCommit: "abc1234" };
const fail: GateFacts = { verdict: "NOT READY", unresolved: ["Backup is stale", "No restore drill"], currentCommit: "abc1234" };
const st = (status: GoLiveSnapshot["status"], over: Partial<GoLiveSnapshot> = {}): GoLiveSnapshot => ({ status, readyById: null, commitSha: null, ...over });

describe("MARK_READY", () => {
  it("is allowed from blocked when every gate passes", () => {
    expect(decide({ action: "MARK_READY", state: st("GO_LIVE_BLOCKED"), actorId: "a", facts: pass })).toEqual({ ok: true, to: "GO_LIVE_READY" });
  });
  it("is refused while a gate fails, naming what is unresolved", () => {
    const d = decide({ action: "MARK_READY", state: st("GO_LIVE_BLOCKED"), actorId: "a", facts: fail });
    expect(d).toMatchObject({ ok: false, code: "GATES_NOT_PASSED" });
    expect(d.ok ? "" : d.message).toContain("Backup is stale");
  });
  it("is refused for a build that has no commit (not a deployment)", () => {
    expect(decide({ action: "MARK_READY", state: st("GO_LIVE_BLOCKED"), actorId: "a", facts: { ...pass, currentCommit: null } })).toMatchObject({ ok: false, code: "NO_BUILD" });
  });
  it.each(["GO_LIVE_READY", "GO_LIVE_APPROVED", "LIVE"] as const)("is refused from %s", (s) => {
    expect(decide({ action: "MARK_READY", state: st(s), actorId: "a", facts: pass })).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });
});

describe("APPROVE (maker-checker)", () => {
  const ready = st("GO_LIVE_READY", { readyById: "maker", commitSha: "abc1234" });
  it("is allowed for a different administrator on the same build", () => {
    expect(decide({ action: "APPROVE", state: ready, actorId: "checker", facts: pass })).toEqual({ ok: true, to: "GO_LIVE_APPROVED" });
  });
  it("is refused for the person who marked it ready", () => {
    expect(decide({ action: "APPROVE", state: ready, actorId: "maker", facts: pass })).toMatchObject({ ok: false, code: "SAME_PERSON" });
  });
  it("is refused when the gates stopped passing", () => {
    expect(decide({ action: "APPROVE", state: ready, actorId: "checker", facts: fail })).toMatchObject({ ok: false, code: "GATES_NOT_PASSED" });
  });
  it("is refused when another build is now running", () => {
    expect(decide({ action: "APPROVE", state: ready, actorId: "checker", facts: { ...pass, currentCommit: "def5678" } })).toMatchObject({ ok: false, code: "BUILD_CHANGED" });
  });
  it.each(["GO_LIVE_BLOCKED", "GO_LIVE_APPROVED", "LIVE"] as const)("is refused from %s", (s) => {
    expect(decide({ action: "APPROVE", state: st(s, { readyById: "maker", commitSha: "abc1234" }), actorId: "checker", facts: pass })).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });
});

describe("GO_LIVE", () => {
  const approved = st("GO_LIVE_APPROVED", { readyById: "maker", commitSha: "abc1234" });
  it("is allowed from approved when the gates still pass on the same build", () => {
    expect(decide({ action: "GO_LIVE", state: approved, actorId: "x", facts: pass })).toEqual({ ok: true, to: "LIVE" });
  });
  it("cannot skip approval", () => {
    expect(decide({ action: "GO_LIVE", state: st("GO_LIVE_READY", { commitSha: "abc1234" }), actorId: "x", facts: pass })).toMatchObject({ ok: false, code: "WRONG_STATE" });
    expect(decide({ action: "GO_LIVE", state: st("GO_LIVE_BLOCKED"), actorId: "x", facts: pass })).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });
  it("is refused if a gate fails or the build changed in the meantime", () => {
    expect(decide({ action: "GO_LIVE", state: approved, actorId: "x", facts: fail })).toMatchObject({ ok: false, code: "GATES_NOT_PASSED" });
    expect(decide({ action: "GO_LIVE", state: approved, actorId: "x", facts: { ...pass, currentCommit: "zzz" } })).toMatchObject({ ok: false, code: "BUILD_CHANGED" });
  });
});

describe("BLOCK", () => {
  it.each(["GO_LIVE_READY", "GO_LIVE_APPROVED", "LIVE"] as const)("needs a reason and works from %s", (s) => {
    expect(decide({ action: "BLOCK", state: st(s), actorId: "x", facts: pass, reason: "  " })).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(decide({ action: "BLOCK", state: st(s), actorId: "x", facts: pass, reason: "Found a problem" })).toEqual({ ok: true, to: "GO_LIVE_BLOCKED" });
  });
  it("is refused when already blocked", () => {
    expect(decide({ action: "BLOCK", state: st("GO_LIVE_BLOCKED"), actorId: "x", facts: pass, reason: "again please" })).toMatchObject({ ok: false, code: "WRONG_STATE" });
  });
});

describe("autoBlockReason / liveDrift", () => {
  it("drops READY and APPROVED when the proof no longer holds", () => {
    expect(autoBlockReason(st("GO_LIVE_READY", { commitSha: "abc1234" }), fail)).toMatch(/no longer pass/);
    expect(autoBlockReason(st("GO_LIVE_APPROVED", { commitSha: "old" }), pass)).toMatch(/different build/);
    expect(autoBlockReason(st("GO_LIVE_READY", { commitSha: "abc1234" }), pass)).toBeNull();
  });
  it("never changes BLOCKED or LIVE by itself", () => {
    expect(autoBlockReason(st("GO_LIVE_BLOCKED"), fail)).toBeNull();
    expect(autoBlockReason(st("LIVE", { commitSha: "old" }), fail)).toBeNull();
  });
  it("reports drift beside a LIVE state", () => {
    expect(liveDrift(st("LIVE", { commitSha: "abc1234" }), pass)).toEqual([]);
    expect(liveDrift(st("LIVE", { commitSha: "old" }), fail)).toHaveLength(2);
    expect(liveDrift(st("GO_LIVE_READY"), fail)).toEqual([]);
  });
});

it("isGoLiveStatus accepts only the four statuses", () => {
  expect(isGoLiveStatus("LIVE")).toBe(true);
  expect(isGoLiveStatus("live")).toBe(false);
  expect(isGoLiveStatus(null)).toBe(false);
});
