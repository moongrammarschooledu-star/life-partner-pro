import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeMeeting { id: string; proposalId: string; status: string; scheduledAt: Date; locationInfo: string | null; notes: string | null; }
interface FakeProposal { id: string; profileAId: string; profileBId: string; assignedToId: string | null; status: string; }

let meetings: Map<string, FakeMeeting>;
let proposals: Map<string, FakeProposal>;
let auditCalls: Record<string, unknown>[];
let notifyCalls: unknown[][];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyMeetingUpdated: vi.fn(async (...args: unknown[]) => { notifyCalls.push(args); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => proposals.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = proposals.get(where.id)!;
        if (data.status) p.status = data.status as string;
        return p;
      }),
    },
    meeting: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; proposalId: string } }) => {
        const m = meetings.get(where.id);
        return m && m.proposalId === where.proposalId ? m : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const m = meetings.get(where.id)!;
        Object.assign(m, data);
        return { ...m };
      }),
    },
  },
}));

const { applyMeetingUpdate, MeetingWorkflowError } = await import("./meeting-workflow");

beforeEach(() => {
  meetings = new Map([["m1", { id: "m1", proposalId: "prop1", status: "SCHEDULED", scheduledAt: new Date("2026-02-01"), locationInfo: null, notes: null }]]);
  proposals = new Map([["prop1", { id: "prop1", profileAId: "me", profileBId: "other", assignedToId: "admin1", status: "MEETING_SCHEDULED" }]]);
  auditCalls = [];
  notifyCalls = [];
});

describe("applyMeetingUpdate — admin actor (regression)", () => {
  it("updates status, writes MEETING_MODIFIED audit, and notifies", async () => {
    const result = await applyMeetingUpdate("prop1", "m1", { status: "CONFIRMED" }, { type: "admin", adminId: "admin1" });
    expect(result.status).toBe("CONFIRMED");
    expect(auditCalls[0]).toMatchObject({ action: "MEETING_MODIFIED", adminId: "admin1" });
    expect(notifyCalls[0]).toEqual(["me", "other", "prop1", "CONFIRMED", "admin1"]);
  });

  it("flips proposal status to MEETING_COMPLETED when status becomes COMPLETED", async () => {
    await applyMeetingUpdate("prop1", "m1", { status: "COMPLETED" }, { type: "admin", adminId: "admin1" });
    expect(proposals.get("prop1")!.status).toBe("MEETING_COMPLETED");
  });

  it("admin can move scheduledAt directly", async () => {
    const result = await applyMeetingUpdate("prop1", "m1", { scheduledAt: "2026-03-01" }, { type: "admin", adminId: "admin1" });
    expect(new Date(result.scheduledAt).getFullYear()).toBe(2026);
  });
});

describe("applyMeetingUpdate — applicant actor restrictions", () => {
  it("allows confirming a SCHEDULED meeting", async () => {
    const result = await applyMeetingUpdate("prop1", "m1", { status: "CONFIRMED" }, { type: "applicant", profileId: "me" });
    expect(result.status).toBe("CONFIRMED");
    expect(auditCalls[0].action).toBe("MEETING_CONFIRMED_BY_APPLICANT");
  });

  it("rejects an applicant setting COMPLETED", async () => {
    await expect(applyMeetingUpdate("prop1", "m1", { status: "COMPLETED" }, { type: "applicant", profileId: "me" })).rejects.toThrow(MeetingWorkflowError);
  });

  it("rejects an applicant moving scheduledAt directly", async () => {
    await expect(applyMeetingUpdate("prop1", "m1", { scheduledAt: "2026-03-01" }, { type: "applicant", profileId: "me" })).rejects.toThrow(/Only staff/);
  });

  it("appends a reschedule note instead of moving scheduledAt", async () => {
    const result = await applyMeetingUpdate("prop1", "m1", { status: "RESCHEDULED", applicantRescheduleNote: "Can we do Friday instead?" }, { type: "applicant", profileId: "me" });
    expect(result.status).toBe("RESCHEDULED");
    expect(result.notes).toContain("Can we do Friday instead?");
    expect(new Date(result.scheduledAt).getTime()).toBe(new Date("2026-02-01").getTime());
  });

  it("IDOR: rejects an applicant who isn't part of the proposal, identically to not-found", async () => {
    await expect(applyMeetingUpdate("prop1", "m1", { status: "CONFIRMED" }, { type: "applicant", profileId: "stranger" })).rejects.toThrow(/not found/i);
  });

  it("IDOR: rejects a meetingId that belongs to a different proposal", async () => {
    meetings.set("m2", { id: "m2", proposalId: "otherProposal", status: "SCHEDULED", scheduledAt: new Date(), locationInfo: null, notes: null });
    await expect(applyMeetingUpdate("prop1", "m2", { status: "CONFIRMED" }, { type: "applicant", profileId: "me" })).rejects.toThrow(/not found/i);
  });
});
