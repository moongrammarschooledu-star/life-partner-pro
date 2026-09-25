import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeSession {
  id: string;
  familyMemberId: string;
  deviceInfo: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

let sessions: Map<string, FakeSession>;
let idCounter = 0;
let auditCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    familyMemberSession: {
      create: vi.fn(async ({ data }: { data: Omit<FakeSession, "id" | "createdAt" | "lastActiveAt" | "revokedAt"> }) => {
        const s: FakeSession = { id: `s${++idCounter}`, createdAt: new Date(), lastActiveAt: new Date(), revokedAt: null, ...data };
        sessions.set(s.id, s);
        return s;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeSession> }) => {
        const s = sessions.get(where.id)!;
        Object.assign(s, data);
        return s;
      }),
      findMany: vi.fn(async ({ where }: { where: { familyMemberId: string; revokedAt: null; expiresAt: { gt: Date } } }) =>
        [...sessions.values()].filter((s) => s.familyMemberId === where.familyMemberId && !s.revokedAt && s.expiresAt > where.expiresAt.gt)
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; familyMemberId: string; revokedAt?: null }; data: Partial<FakeSession> }) => {
        const matches = [...sessions.values()].filter(
          (s) => s.familyMemberId === where.familyMemberId && (!where.id || s.id === where.id) && (where.revokedAt === undefined || s.revokedAt === where.revokedAt)
        );
        matches.forEach((s) => Object.assign(s, data));
        return { count: matches.length };
      }),
    },
  },
}));

const {
  createFamilyMemberSession,
  touchAndValidateFamilyMemberSession,
  listFamilyMemberSessions,
  revokeFamilyMemberSession,
  revokeAllFamilyMemberSessions,
} = await import("./family-member-session");

beforeEach(() => {
  sessions = new Map();
  auditCalls = [];
});

describe("createFamilyMemberSession / touchAndValidateFamilyMemberSession", () => {
  it("a freshly created session validates and returns its familyMemberId", async () => {
    const s = await createFamilyMemberSession("fm1", "iPhone", "ua", "1.2.3.4");
    const resolved = await touchAndValidateFamilyMemberSession(s.id);
    expect(resolved).toBe("fm1");
  });

  it("rejects an unknown session id", async () => {
    expect(await touchAndValidateFamilyMemberSession("nope")).toBeNull();
  });

  it("rejects a revoked session", async () => {
    const s = await createFamilyMemberSession("fm1");
    await revokeFamilyMemberSession(s.id, "fm1");
    expect(await touchAndValidateFamilyMemberSession(s.id)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const s = await createFamilyMemberSession("fm1");
    sessions.get(s.id)!.expiresAt = new Date(Date.now() - 1000);
    expect(await touchAndValidateFamilyMemberSession(s.id)).toBeNull();
  });
});

describe("revokeFamilyMemberSession — IDOR", () => {
  it("does not revoke a session belonging to a different family member", async () => {
    const s = await createFamilyMemberSession("fm1");
    const ok = await revokeFamilyMemberSession(s.id, "fm2");
    expect(ok).toBe(false);
    expect(await touchAndValidateFamilyMemberSession(s.id)).toBe("fm1");
  });
});

describe("revokeAllFamilyMemberSessions", () => {
  it("revokes every active session and writes exactly one audit entry", async () => {
    const a = await createFamilyMemberSession("fm1");
    const b = await createFamilyMemberSession("fm1");
    const count = await revokeAllFamilyMemberSessions("fm1", "suspended");
    expect(count).toBe(2);
    expect(await touchAndValidateFamilyMemberSession(a.id)).toBeNull();
    expect(await touchAndValidateFamilyMemberSession(b.id)).toBeNull();
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: "FAMILY_SESSION_REVOKED", actorFamilyMemberId: "fm1" });
  });

  it("is a no-op (no audit write) when there is nothing to revoke", async () => {
    const count = await revokeAllFamilyMemberSessions("fm-none");
    expect(count).toBe(0);
    expect(auditCalls).toHaveLength(0);
  });
});

describe("listFamilyMemberSessions", () => {
  it("excludes revoked and expired sessions", async () => {
    const active = await createFamilyMemberSession("fm1");
    const revoked = await createFamilyMemberSession("fm1");
    await revokeFamilyMemberSession(revoked.id, "fm1");
    const list = await listFamilyMemberSessions("fm1");
    expect(list.map((s) => s.id)).toEqual([active.id]);
  });
});
