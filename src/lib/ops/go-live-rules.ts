// STEP 34 §45 — the go-live approval gate, as pure rules (no database, no clock) so every refusal can be tested.
//
//   GO_LIVE_BLOCKED  --MARK_READY-->  GO_LIVE_READY  --APPROVE-->  GO_LIVE_APPROVED  --GO_LIVE-->  LIVE
//        ^                                  |                              |                         |
//        +------------- BLOCK / AUTO_BLOCK -+------------------------------+------- BLOCK ----------+
//
// * MARK_READY needs the production-readiness verdict to be READY right now (the STEP 15 evaluator — never a hand-typed "yes").
// * APPROVE must be done by a DIFFERENT administrator than the one who marked it ready (maker-checker), and only for the same build.
// * GO_LIVE re-checks the verdict and the build; "LIVE" is a record that the owners declared launch, it does not itself move traffic.
// * While READY or APPROVED, a failing gate or a different build drops the state back to BLOCKED automatically (AUTO_BLOCK).
//   A state that is already LIVE is never changed behind the owners' backs — drift is shown as a warning instead.

export const GO_LIVE_STATUSES = ["GO_LIVE_BLOCKED", "GO_LIVE_READY", "GO_LIVE_APPROVED", "LIVE"] as const;
export type GoLiveStatus = (typeof GO_LIVE_STATUSES)[number];
export type GoLiveAction = "MARK_READY" | "APPROVE" | "GO_LIVE" | "BLOCK";

export interface GoLiveSnapshot {
  status: GoLiveStatus;
  readyById: string | null;
  commitSha: string | null;
}

export interface GateFacts {
  verdict: "READY" | "NOT READY";
  unresolved: string[];
  /** The build that is running right now (null when running locally). */
  currentCommit: string | null;
}

export type Decision = { ok: true; to: GoLiveStatus } | { ok: false; code: string; message: string };

const refuse = (code: string, message: string): Decision => ({ ok: false, code, message });

export function isGoLiveStatus(value: unknown): value is GoLiveStatus {
  return typeof value === "string" && (GO_LIVE_STATUSES as readonly string[]).includes(value);
}

function gatesOpen(facts: GateFacts): Decision | null {
  if (facts.verdict !== "READY") {
    const first = facts.unresolved.slice(0, 3).join("; ");
    return refuse("GATES_NOT_PASSED", `${facts.unresolved.length} required readiness gate(s) are not passing${first ? `: ${first}` : ""}.`);
  }
  return null;
}

export function decide(input: { action: GoLiveAction; state: GoLiveSnapshot; actorId: string; facts: GateFacts; reason?: string | null }): Decision {
  const { action, state, actorId, facts } = input;
  const reason = input.reason?.trim() ?? "";

  switch (action) {
    case "MARK_READY": {
      if (state.status !== "GO_LIVE_BLOCKED") return refuse("WRONG_STATE", `Only a blocked go-live can be marked ready (it is ${state.status}).`);
      const g = gatesOpen(facts);
      if (g) return g;
      if (!facts.currentCommit) return refuse("NO_BUILD", "This is not a deployed build (no commit is recorded), so it cannot be judged ready.");
      return { ok: true, to: "GO_LIVE_READY" };
    }
    case "APPROVE": {
      if (state.status !== "GO_LIVE_READY") return refuse("WRONG_STATE", `Only a go-live that is marked ready can be approved (it is ${state.status}).`);
      if (state.readyById && state.readyById === actorId) return refuse("SAME_PERSON", "A different administrator must approve - you marked this ready yourself.");
      const g = gatesOpen(facts);
      if (g) return g;
      if (state.commitSha !== facts.currentCommit) return refuse("BUILD_CHANGED", "The running build is not the build that was marked ready. Mark it ready again.");
      return { ok: true, to: "GO_LIVE_APPROVED" };
    }
    case "GO_LIVE": {
      if (state.status !== "GO_LIVE_APPROVED") return refuse("WRONG_STATE", `Only an approved go-live can be recorded as live (it is ${state.status}).`);
      const g = gatesOpen(facts);
      if (g) return g;
      if (state.commitSha !== facts.currentCommit) return refuse("BUILD_CHANGED", "The running build is not the build that was approved. Start again from ready.");
      return { ok: true, to: "LIVE" };
    }
    case "BLOCK": {
      if (state.status === "GO_LIVE_BLOCKED") return refuse("WRONG_STATE", "It is already blocked.");
      if (reason.length < 5) return refuse("REASON_REQUIRED", "A reason (at least 5 characters) is required to block.");
      return { ok: true, to: "GO_LIVE_BLOCKED" };
    }
    default:
      return refuse("UNKNOWN_ACTION", "Unknown action.");
  }
}

/** Should a state that is READY or APPROVED fall back to BLOCKED because the proof behind it no longer holds? */
export function autoBlockReason(state: GoLiveSnapshot, facts: GateFacts): string | null {
  if (state.status !== "GO_LIVE_READY" && state.status !== "GO_LIVE_APPROVED") return null;
  if (facts.verdict !== "READY") return `Readiness gates no longer pass (${facts.unresolved.length} unresolved).`;
  if (state.commitSha !== facts.currentCommit) return "A different build is now running than the one that was judged.";
  return null;
}

/** Shown beside a LIVE state; never changes it. */
export function liveDrift(state: GoLiveSnapshot, facts: GateFacts): string[] {
  if (state.status !== "LIVE") return [];
  const out: string[] = [];
  if (facts.verdict !== "READY") out.push(`Readiness gates are not all passing now (${facts.unresolved.length} unresolved).`);
  if (state.commitSha && facts.currentCommit && state.commitSha !== facts.currentCommit) out.push("The running build is newer than the one that was approved for launch.");
  return out;
}
