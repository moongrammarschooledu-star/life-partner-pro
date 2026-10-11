import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 32 milestone 4 — incident response: the workflow and what each step requires, evidence as pointers only, and containment where a
// broad action needs a different person's approval and nobody can contain (or approve) themselves.

type Row = Record<string, unknown> & { id?: string };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: {
      socIncident: { status: "DETECTED", ownerId: null, rootCause: null, lessonsLearned: null, communicationPlan: null, closedAt: null },
      socContainmentAction: { status: "REQUESTED", approvedById: null, decidedAt: null, decisionNote: null, executedAt: null, result: null, technicalControlId: null },
      securityIncident: { status: "ACTIVE" },
      socAlert: { status: "NEW", occurrences: 1, escalationLevel: 0 },
    },
    nested: { socIncident: ["events", "socIncidentEvent", "incidentId"] },
    relations: { socIncident: { events: ["socIncidentEvent", "incidentId", "many"], containment: ["socContainmentAction", "incidentId", "many"] } },
  });
  return { prisma: h.fake.prisma };
});

const audits: Row[] = [];
const sent: Row[] = [];
const perms: Record<string, string[]> = {
  OWNER: ["soc:incidents:manage"],
  APPROVER: ["soc:containment:approve"],
  PLAIN: ["profile:view"],
};

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: vi.fn(async (a: Row) => { sent.push(a); }) }));
vi.mock("@/lib/effective-permissions", () => ({ resolveEffectivePermissions: vi.fn(async (a: { role: string }) => perms[a.role] ?? []) }));

const inc = await import("./incidents");
const cont = await import("./containment");

const rows = (t: string) => h.fake.rows(t);
const lead = { id: "lead-1", permissions: ["soc:incidents:manage", "soc:containment:request"] };
const approver = { id: "appr-1", permissions: ["soc:containment:approve"] };
const noPerm = { id: "nobody", permissions: [] as string[] };

beforeEach(() => {
  h.fake.reset();
  audits.length = 0;
  sent.length = 0;
  rows("adminUser").push({ id: "owner-1", role: "OWNER", customRoleId: null, active: true }, { id: "appr-1", role: "APPROVER", customRoleId: null, active: true }, { id: "plain-1", role: "PLAIN", customRoleId: null, active: true });
});

const base = { title: "Repeated sign-ins from one network", category: "AUTHENTICATION_ATTACK" as const, severity: "HIGH" as const, summary: "Many accounts were tried from one network address overnight." };
const open = async (over: Partial<Parameters<typeof inc.createIncident>[1]> = {}) => inc.createIncident(lead, { ...base, ...over });
const walkTo = async (id: string, steps: Array<[Parameters<typeof inc.moveIncident>[2], string?]>) => { for (const [to, note] of steps) await inc.moveIncident(lead, id, to, note); };

describe("the workflow rules (pure)", () => {
  it("moves one step at a time, with two documented exceptions", () => {
    const flow = inc.INCIDENT_FLOW;
    for (let i = 0; i < flow.length - 1; i++) expect(inc.canMove(flow[i], flow[i + 1]), flow[i]).toBe(true);
    expect(inc.canMove("DETECTED", "CONTAINMENT")).toBe(false);
    expect(inc.canMove("TRIAGED", "CLOSED")).toBe(false);
    expect(inc.canMove("INVESTIGATING", "REMEDIATION")).toBe(true); // nothing to contain
    expect(inc.canMove("REMEDIATION", "INVESTIGATING")).toBe(true); // new facts reopen the investigation
    expect(inc.canMove("DETECTED", "INVESTIGATING")).toBe(false);
    for (const to of flow) expect(inc.canMove("CLOSED", to)).toBe(false);
  });

  it("each step names what it needs", () => {
    const facts = { ownerId: null, rootCause: null, lessonsLearned: null, communicationPlan: null, severity: "HIGH" as const, pendingContainment: 0 };
    expect(inc.moveBlocker("TRIAGED", facts)).toMatch(/owner/i);
    expect(inc.moveBlocker("TRIAGED", { ...facts, ownerId: "x" })).toBeNull();
    expect(inc.moveBlocker("REMEDIATION", facts, "short")).toMatch(/what was done/i);
    expect(inc.moveBlocker("REMEDIATION", facts, "Blocked the network for an hour")).toBeNull();
    expect(inc.moveBlocker("POST_INCIDENT_REVIEW", facts)).toMatch(/root cause/i);
    expect(inc.moveBlocker("CLOSED", { ...facts, rootCause: "A reused password list was tried against sign-in." })).toMatch(/lessons/i);
    const done = { ...facts, rootCause: "A reused password list was tried against sign-in.", lessonsLearned: "Tighten the failed-sign-in rule and add monitoring." };
    expect(inc.moveBlocker("CLOSED", done)).toMatch(/communication plan/i);
    expect(inc.moveBlocker("CLOSED", { ...done, severity: "LOW" })).toBeNull();
    expect(inc.moveBlocker("CLOSED", { ...done, communicationPlan: "Inform affected account owners.", pendingContainment: 1 })).toMatch(/waiting for a decision/i);
    expect(inc.moveBlocker("CLOSED", { ...done, communicationPlan: "Inform affected account owners." })).toBeNull();
  });

  it("classifies containment by how broad it is", () => {
    expect(cont.classify("REVOKE_SESSION", { sessionId: "sess-1" })).toMatchObject({ impact: "LOW" });
    expect(cont.classify("REVOKE_ADMIN_SESSIONS", { adminId: "adm-1" })).toMatchObject({ impact: "HIGH" });
    expect(cont.classify("THROTTLE_SUBJECT", { subjectType: "SUBJECT_KEY", subjectRef: "abc-hash", minutes: 120 }).impact).toBe("LOW");
    expect(cont.classify("THROTTLE_SUBJECT", { subjectType: "SUBJECT_KEY", subjectRef: "abc-hash", minutes: 121 }).impact).toBe("HIGH");
    expect(cont.classify("BLOCK_NETWORK_HASH", { ipHash: "net-1", minutes: 60 }).impact).toBe("LOW");
    expect(cont.classify("BLOCK_NETWORK_HASH", { ipHash: "net-1", minutes: 61 }).impact).toBe("HIGH");
    expect(cont.classify("EMERGENCY_SWITCH", { switch: "payments" }).impact).toBe("HIGH");
  });

  it("rejects bad parameters instead of guessing", () => {
    for (const bad of [
      () => cont.classify("REVOKE_SESSION", {}),
      () => cont.classify("REVOKE_SESSION", { sessionId: "has space" }),
      () => cont.classify("THROTTLE_SUBJECT", { subjectType: "SUBJECT_KEY", subjectRef: "abc-hash", minutes: 0 }),
      () => cont.classify("THROTTLE_SUBJECT", { subjectType: "SUBJECT_KEY", subjectRef: "abc-hash", minutes: 1441 }),
      () => cont.classify("THROTTLE_SUBJECT", { subjectType: "EVERYONE" as never, subjectRef: "abc-hash", minutes: 5 }),
      () => cont.classify("BLOCK_NETWORK_HASH", { ipHash: "net-1", minutes: 1.5 }),
      () => cont.classify("EMERGENCY_SWITCH", { switch: "everything" as never }),
      () => cont.classify("WIPE_DATABASE" as never, {}),
    ]) expect(bad).toThrow(/./);
  });
});

describe("opening an incident", () => {
  it("numbers it in the shared LPP-INC sequence, links alerts as evidence pointers, and tells the approvers of a HIGH one", async () => {
    rows("socAlert").push({ id: "al-1", alertCode: "LPP-SEC-ALERT-000001" }, { id: "al-2", alertCode: "LPP-SEC-ALERT-000002" });
    const a = await open({ alertIds: ["al-1", "al-2"] });
    const b = await open({ severity: "LOW" });
    expect(a.incidentCode).toBe("LPP-INC-000001");
    expect(b.incidentCode).toBe("LPP-INC-000002");
    expect(a.status).toBe("DETECTED");
    expect(a.evidenceRefs).toEqual([{ type: "SocAlert", id: "al-1", note: "LPP-SEC-ALERT-000001" }, { type: "SocAlert", id: "al-2", note: "LPP-SEC-ALERT-000002" }]);
    expect(rows("socAlert").every((x) => x.incidentId === a.id)).toBe(true);
    expect(sent.map((s) => s.adminId)).toEqual(["appr-1"]); // only the HIGH one notified
    expect(rows("socIncidentEvent").filter((e) => e.incidentId === a.id)[0]).toMatchObject({ kind: "CREATED", toStatus: "DETECTED" });
    expect(audits.filter((x) => x.action === "SOC_INCIDENT_CREATED")).toHaveLength(2);
  });

  it("refuses a missing title or summary, an unknown alert, and an owner who cannot own incidents", async () => {
    await expect(open({ title: "no" })).rejects.toMatchObject({ status: 422 });
    await expect(open({ summary: "short" })).rejects.toMatchObject({ status: 422 });
    await expect(open({ alertIds: ["ghost"] })).rejects.toMatchObject({ status: 422 });
    await expect(open({ ownerId: "plain-1" })).rejects.toMatchObject({ status: 422 });
    await expect(open({ category: "SOMETHING" as never })).rejects.toMatchObject({ status: 422 });
    expect((await open({ ownerId: "owner-1" })).ownerId).toBe("owner-1");
  });
});

describe("moving through the workflow", () => {
  it("cannot be closed until the review is written, and every step lands on the timeline", async () => {
    const i = await open();
    await expect(inc.moveIncident(lead, i.id, "CONTAINMENT")).rejects.toMatchObject({ status: 409 });
    await expect(inc.moveIncident(lead, i.id, "TRIAGED")).rejects.toMatchObject({ status: 422 }); // no owner yet
    await inc.setOwner(lead, i.id, "owner-1");
    await walkTo(i.id, [["TRIAGED"], ["INVESTIGATING"], ["CONTAINMENT"], ["REMEDIATION", "Blocked the network and reset the affected accounts"], ["RECOVERY"]]);
    await expect(inc.moveIncident(lead, i.id, "POST_INCIDENT_REVIEW")).rejects.toMatchObject({ status: 422 });
    await inc.recordIncidentField(lead, i.id, "rootCause", "A list of reused passwords was tried against the sign-in page.");
    await inc.moveIncident(lead, i.id, "POST_INCIDENT_REVIEW");
    await expect(inc.moveIncident(lead, i.id, "CLOSED")).rejects.toMatchObject({ status: 422 });
    await inc.recordIncidentField(lead, i.id, "lessonsLearned", "Lower the failed sign-in threshold and watch one network across accounts.");
    await expect(inc.moveIncident(lead, i.id, "CLOSED")).rejects.toMatchObject({ status: 422 }); // HIGH: communication plan
    await inc.recordIncidentField(lead, i.id, "communicationPlan", "Tell affected account owners to change their passwords.");
    const closed = await inc.moveIncident(lead, i.id, "CLOSED", "Reviewed and closed");
    expect(closed).toMatchObject({ status: "CLOSED" });
    expect(closed.closedAt).toBeInstanceOf(Date);
    const steps = rows("socIncidentEvent").filter((e) => e.incidentId === i.id && e.kind === "STATUS").map((e) => e.toStatus);
    expect(steps).toEqual(["TRIAGED", "INVESTIGATING", "CONTAINMENT", "REMEDIATION", "RECOVERY", "POST_INCIDENT_REVIEW", "CLOSED"]);
    await expect(inc.recordIncidentField(lead, i.id, "rootCause", "Trying to rewrite history afterwards.")).rejects.toMatchObject({ status: 409 });
    await expect(inc.moveIncident(lead, i.id, "INVESTIGATING")).rejects.toMatchObject({ status: 409 });
  });

  it("new facts can reopen the investigation from a middle stage", async () => {
    const i = await open({ ownerId: "owner-1" });
    await walkTo(i.id, [["TRIAGED"], ["INVESTIGATING"], ["CONTAINMENT"], ["REMEDIATION", "Contained, moving on to cleanup"]]);
    expect((await inc.moveIncident(lead, i.id, "INVESTIGATING", "Second network found")).status).toBe("INVESTIGATING");
  });

  it("evidence is a pointer: known type, plain identifier, no content, no duplicates", async () => {
    const i = await open();
    await inc.addEvidence(lead, i.id, { type: "SecurityEvent", id: "ev-123", note: "first failed sign-in" });
    await inc.addEvidence(lead, i.id, { type: "SecurityEvent", id: "ev-123" });
    expect(((await inc.getIncident(i.id)).evidenceRefs as unknown[]).length).toBe(1);
    await expect(inc.addEvidence(lead, i.id, { type: "Passwords", id: "ev-1" })).rejects.toMatchObject({ status: 422 });
    await expect(inc.addEvidence(lead, i.id, { type: "Other", id: "jane@example.com" })).rejects.toMatchObject({ status: 422 });
    await expect(inc.addEvidence(lead, i.id, { type: "Other", id: "a long free-text description of what happened" })).rejects.toMatchObject({ status: 422 });
  });

  it("owners must be able to own incidents, and notes are kept as timeline entries", async () => {
    const i = await open();
    await expect(inc.setOwner(lead, i.id, "plain-1")).rejects.toMatchObject({ status: 422 });
    await inc.setOwner(lead, i.id, "owner-1");
    await inc.addIncidentNote(lead, i.id, "Spoke to the hosting provider; no further activity.");
    expect(rows("socIncidentEvent").some((e) => e.kind === "NOTE")).toBe(true);
    await expect(inc.addIncidentNote(lead, i.id, "x")).rejects.toMatchObject({ status: 422 });
  });
});

describe("containment", () => {
  async function investigating() {
    const i = await open({ ownerId: "owner-1" });
    await walkTo(i.id, [["TRIAGED"], ["INVESTIGATING"]]);
    return i.id;
  }
  const session = (id: string, adminId: string, revokedAt: Date | null = null) => rows("adminSession").push({ id, adminId, revokedAt });

  it("a narrow action runs at once for someone who may request it", async () => {
    const id = await investigating();
    session("s-1", "victim-1");
    const r = await cont.requestContainment(lead, id, "REVOKE_SESSION", { sessionId: "s-1" }, "Session used from an unexpected network");
    expect(r).toMatchObject({ status: "EXECUTED", impact: "LOW", result: "1 session revoked" });
    expect(rows("adminSession")[0].revokedAt).toBeInstanceOf(Date);
    expect(rows("adminSession")[0].revokedById).toBe("lead-1");
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["SOC_CONTAINMENT_REQUESTED", "SOC_CONTAINMENT_EXECUTED", "ADMIN_SESSION_REVOKED"]));
  });

  it("a broad action waits for a different approver, who is notified", async () => {
    const id = await investigating();
    session("s-1", "victim-1");
    session("s-2", "victim-1");
    session("s-3", "someone-else");
    const r = await cont.requestContainment(lead, id, "REVOKE_ADMIN_SESSIONS", { adminId: "victim-1" }, "Credentials believed to be exposed");
    expect(r).toMatchObject({ status: "REQUESTED", impact: "HIGH" });
    expect(rows("adminSession").every((s) => !s.revokedAt)).toBe(true); // nothing happened yet
    expect(sent.filter((s) => s.type === "SOC_INCIDENT").map((s) => s.adminId)).toContain("appr-1");
    const done = await cont.decideContainment(approver, r.id as string, "APPROVE", "Agreed, exposure confirmed");
    expect(done).toMatchObject({ status: "EXECUTED", result: "2 session(s) revoked", approvedById: "appr-1" });
    expect(rows("adminSession").filter((s) => s.revokedAt).map((s) => s.id).sort()).toEqual(["s-1", "s-2"]);
  });

  it("nobody approves their own request, and approval needs the permission", async () => {
    const id = await investigating();
    const r = await cont.requestContainment({ ...lead, permissions: [...lead.permissions, "soc:containment:approve"] }, id, "EMERGENCY_SWITCH", { switch: "payments" }, "Payment provider is under attack");
    await expect(cont.decideContainment({ id: "lead-1", permissions: ["soc:containment:approve"] }, r.id as string, "APPROVE", "approving my own")).rejects.toMatchObject({ status: 403 });
    await expect(cont.decideContainment(noPerm, r.id as string, "APPROVE", "no permission here")).rejects.toMatchObject({ status: 403 });
    expect(rows("systemControl")).toHaveLength(0);
  });

  it("an approved emergency switch is turned ON and audited; a rejection changes nothing; a decided request cannot be decided again", async () => {
    const id = await investigating();
    const a = await cont.requestContainment(lead, id, "EMERGENCY_SWITCH", { switch: "payments" }, "Payment provider is under attack");
    await cont.decideContainment(approver, a.id as string, "APPROVE", "Confirmed with the provider status page");
    expect(rows("systemControl")[0]).toMatchObject({ emergencyPaymentsDisabled: true, updatedById: "appr-1" });
    expect(audits.some((x) => x.action === "EMERGENCY_SWITCH_CHANGED")).toBe(true);
    await expect(cont.decideContainment(approver, a.id as string, "APPROVE", "again please")).rejects.toMatchObject({ status: 409 });
    const b = await cont.requestContainment(lead, id, "EMERGENCY_SWITCH", { switch: "uploads" }, "Suspicious uploads being tested");
    const rej = await cont.decideContainment(approver, b.id as string, "REJECT", "Not enough evidence yet");
    expect(rej.status).toBe("REJECTED");
    expect(rows("systemControl")[0].emergencyUploadsDisabled).toBeUndefined();
  });

  it("nobody can contain their own account, as requester or as approver", async () => {
    const id = await investigating();
    await expect(cont.requestContainment(lead, id, "REVOKE_ADMIN_SESSIONS", { adminId: "lead-1" }, "Trying to lock myself out")).rejects.toMatchObject({ status: 403 });
    const r = await cont.requestContainment(lead, id, "REVOKE_ADMIN_SESSIONS", { adminId: "appr-1" }, "The approver's account may be exposed");
    await expect(cont.decideContainment(approver, r.id as string, "APPROVE", "approving action on me")).rejects.toMatchObject({ status: 403 });
    session("s-me", "lead-1");
    const own = await cont.requestContainment(lead, id, "REVOKE_SESSION", { sessionId: "s-me" }, "Revoke one of my own sessions");
    expect(own.status).toBe("FAILED"); // execution refuses a session of the person acting
    expect(rows("adminSession")[0].revokedAt).toBeNull();
  });

  it("a short throttle or block is applied as an expiring technical control (never a decision about a person)", async () => {
    const id = await investigating();
    const t = await cont.requestContainment(lead, id, "THROTTLE_SUBJECT", { subjectType: "SUBJECT_KEY", subjectRef: "acct-hash", minutes: 30 }, "Slow the guessing against one account");
    expect(t).toMatchObject({ status: "EXECUTED" });
    const control = rows("securityIncident")[0];
    expect(control).toMatchObject({ controlType: "SUBJECT_THROTTLE", subjectType: "SUBJECT_KEY", subjectRef: "acct-hash", status: "ACTIVE" });
    expect((control.expiresAt as Date).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5000);
    expect(t.technicalControlId).toBe(control.id);
    const longBlock = await cont.requestContainment(lead, id, "BLOCK_NETWORK_HASH", { ipHash: "net-9", minutes: 240 }, "Sustained attack from one network");
    expect(longBlock.status).toBe("REQUESTED"); // longer than an hour: needs approval
  });

  it("is only possible with the permission and while the incident is being worked", async () => {
    const detected = await open();
    await expect(cont.requestContainment(lead, detected.id, "REVOKE_SESSION", { sessionId: "s-1" }, "Too early to contain anything")).rejects.toMatchObject({ status: 409 });
    const id = await investigating();
    await expect(cont.requestContainment(noPerm, id, "REVOKE_SESSION", { sessionId: "s-1" }, "No permission to ask")).rejects.toMatchObject({ status: 403 });
    await expect(cont.requestContainment(lead, id, "REVOKE_SESSION", { sessionId: "s-1" }, "short")).rejects.toMatchObject({ status: 422 });
    await expect(cont.requestContainment(lead, "ghost", "REVOKE_SESSION", { sessionId: "s-1" }, "Incident does not exist")).rejects.toMatchObject({ status: 404 });
  });

  it("an incident cannot be closed while a containment request is waiting", async () => {
    const id = await investigating();
    await cont.requestContainment(lead, id, "EMERGENCY_SWITCH", { switch: "uploads" }, "Suspicious uploads are being tested");
    await walkTo(id, [["REMEDIATION", "Nothing else to contain right now"], ["RECOVERY"]]);
    await inc.recordIncidentField(lead, id, "rootCause", "Automated uploads were probing the validation rules.");
    await inc.moveIncident(lead, id, "POST_INCIDENT_REVIEW");
    await inc.recordIncidentField(lead, id, "lessonsLearned", "Rate limit uploads per network and alert on rejections.");
    await inc.recordIncidentField(lead, id, "communicationPlan", "No applicant data involved; internal note only.");
    await expect(inc.moveIncident(lead, id, "CLOSED")).rejects.toMatchObject({ status: 422 });
  });
});
