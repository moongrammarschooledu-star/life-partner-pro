import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeInvitation {
  id: string;
  invitationCode: string;
  familyAccountId: string;
  invitedName: string;
  invitedEmail: string | null;
  invitedMobile: string | null;
  relationship: string;
  requestedRole: string;
  tokenHash: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  familyMemberId: string | null;
}
interface FakeAccount { id: string; familyCode: string; applicantId: string; status: string; }
interface FakeMember { id: string; familyAccountId: string; email: string | null; mobile: string | null; fullName: string; relationship: string; role: string; status: string; passwordHash: string; emailVerified: boolean; }

let invitations: Map<string, FakeInvitation>;
let accounts: Map<string, FakeAccount>;
let members: Map<string, FakeMember>;
let permissions: Record<string, unknown>[];
let consents: Record<string, unknown>[];
let auditCalls: Record<string, unknown>[];
let taskCalls: Record<string, unknown>[];
let emailCalls: { to: string; body: string; subject?: string }[];
let idCounter = 0;
let seqCounter = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/admin-tasks", () => ({ createTask: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyFamilyInvitationAccepted: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/providers/email-provider", () => ({
  emailProvider: { send: vi.fn(async (to: string, body: string, subject?: string) => { emailCalls.push({ to, body, subject }); return { providerMessageId: "x" }; }) },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    familyAccount: {
      findUnique: vi.fn(async ({ where }: { where: { applicantId?: string; id?: string } }) => {
        if (where.applicantId) return [...accounts.values()].find((a) => a.applicantId === where.applicantId) ?? null;
        return accounts.get(where.id!) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakeAccount, "id" | "status"> }) => {
        const a: FakeAccount = { id: `acc${++idCounter}`, status: "ACTIVE", ...data };
        accounts.set(a.id, a);
        return a;
      }),
    },
    familyInvitation: {
      create: vi.fn(async ({ data }: { data: Omit<FakeInvitation, "id" | "createdAt" | "acceptedAt" | "revokedAt" | "familyMemberId"> }) => {
        const inv: FakeInvitation = { id: `inv${++idCounter}`, createdAt: new Date(), acceptedAt: null, revokedAt: null, familyMemberId: null, ...data };
        invitations.set(inv.invitationCode, inv);
        return inv;
      }),
      findUnique: vi.fn(async ({ where }: { where: { invitationCode: string } }) => invitations.get(where.invitationCode) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { id: string; familyAccount: { applicantId: string } } }) => {
        const inv = [...invitations.values()].find((i) => i.id === where.id);
        if (!inv) return null;
        const acc = accounts.get(inv.familyAccountId);
        return acc?.applicantId === where.familyAccount.applicantId ? inv : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeInvitation> }) => {
        const inv = [...invitations.values()].find((i) => i.id === where.id)!;
        Object.assign(inv, data);
        return inv;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; familyAccount: { applicantId: string }; status: { notIn: string[] } }; data: Partial<FakeInvitation> }) => {
        const inv = [...invitations.values()].find((i) => i.id === where.id);
        if (!inv) return { count: 0 };
        const acc = accounts.get(inv.familyAccountId);
        if (acc?.applicantId !== where.familyAccount.applicantId) return { count: 0 };
        if (where.status.notIn.includes(inv.status)) return { count: 0 };
        Object.assign(inv, data);
        return { count: 1 };
      }),
    },
    familyMember: {
      findFirst: vi.fn(async ({ where }: { where: { familyAccountId: string; email: string } }) =>
        [...members.values()].find((m) => m.familyAccountId === where.familyAccountId && m.email === where.email) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<FakeMember, "id"> }) => {
        const m: FakeMember = { id: `fm${++idCounter}`, ...data };
        members.set(m.id, m);
        return m;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeMember> }) => {
        const m = members.get(where.id)!;
        Object.assign(m, data);
        return m;
      }),
    },
    familyConsent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { consents.push(data); return data; }) },
    familyPermission: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        const row = { status: "ACTIVE", ...create };
        permissions.push(row);
        return row;
      }),
    },
    appSettings: { findUnique: vi.fn(async () => ({ passwordMinLength: 8 })) },
    sequenceCounter: {
      upsert: vi.fn(async () => ({ lastSeq: ++seqCounter })),
    },
  },
}));

const { createInvitation, resendInvitation, revokeInvitation, acceptInvitation, FamilyInvitationError } = await import("./invitation");

beforeEach(() => {
  invitations = new Map();
  accounts = new Map();
  members = new Map();
  permissions = [];
  consents = [];
  auditCalls = [];
  taskCalls = [];
  emailCalls = [];
  process.env.NEXTAUTH_URL = "https://lifepartnerpro.example";
});

describe("createInvitation", () => {
  it("creates a family account lazily and sends an invitation email with a working link", async () => {
    const result = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    expect(accounts.size).toBe(1);
    expect(invitations.size).toBe(1);
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].body).toContain(result.rawToken);
    expect(emailCalls[0].body).toContain(result.invitationCode);
  });

  it("requires an email or mobile number", async () => {
    await expect(createInvitation({ applicantId: "app1", invitedName: "X", relationship: "Sibling" })).rejects.toThrow(FamilyInvitationError);
  });
});

describe("acceptInvitation", () => {
  it("valid invitation works end-to-end", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent", requestedRole: "FAMILY_VIEWER" as never });
    const { familyMemberId } = await acceptInvitation({ invitationCode, token: rawToken, password: "supersecret1" });
    expect(members.get(familyMemberId)).toBeDefined();
    expect(members.get(familyMemberId)!.status).toBe("ACTIVE");
    expect(invitations.get(invitationCode)!.status).toBe("ACCEPTED");
    expect(consents).toHaveLength(1);
    expect(permissions.length).toBeGreaterThan(0); // FAMILY_VIEWER defaults applied
  });

  it("rejects an expired invitation", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    invitations.get(invitationCode)!.expiresAt = new Date(Date.now() - 1000);
    await expect(acceptInvitation({ invitationCode, token: rawToken, password: "supersecret1" })).rejects.toThrow(/expired/i);
    expect(invitations.get(invitationCode)!.status).toBe("EXPIRED");
  });

  it("rejects a revoked invitation", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    const inv = invitations.get(invitationCode)!;
    await revokeInvitation(inv.id, "app1");
    await expect(acceptInvitation({ invitationCode, token: rawToken, password: "supersecret1" })).rejects.toThrow(/no longer valid/i);
  });

  it("rejects a reused (already-accepted) token", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    await acceptInvitation({ invitationCode, token: rawToken, password: "supersecret1" });
    await expect(acceptInvitation({ invitationCode, token: rawToken, password: "anotherpassword" })).rejects.toThrow(/already been used/i);
  });

  it("rejects an invalid token even against a real, unexpired invitation (not a lookup-by-hash)", async () => {
    const { invitationCode } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    await expect(acceptInvitation({ invitationCode, token: "wrong-token", password: "supersecret1" })).rejects.toThrow(/invalid invitation/i);
  });

  it("enforces the platform password-length policy", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    await expect(acceptInvitation({ invitationCode, token: rawToken, password: "short" })).rejects.toThrow(/at least/i);
  });
});

describe("resendInvitation", () => {
  it("invalidates the old token — the original token no longer works after resend", async () => {
    const { invitationCode, rawToken: oldToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    const inv = invitations.get(invitationCode)!;
    const { rawToken: newToken } = await resendInvitation(inv.id, "app1");
    expect(newToken).not.toBe(oldToken);

    await expect(acceptInvitation({ invitationCode, token: oldToken, password: "supersecret1" })).rejects.toThrow(/invalid invitation/i);
    const { familyMemberId } = await acceptInvitation({ invitationCode, token: newToken, password: "supersecret1" });
    expect(members.get(familyMemberId)).toBeDefined();
  });

  it("cannot resend an already-accepted invitation", async () => {
    const { invitationCode, rawToken } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    const inv = invitations.get(invitationCode)!;
    await acceptInvitation({ invitationCode, token: rawToken, password: "supersecret1" });
    await expect(resendInvitation(inv.id, "app1")).rejects.toThrow(/already accepted/i);
  });
});

describe("revokeInvitation — IDOR", () => {
  it("does not revoke an invitation belonging to a different applicant", async () => {
    const { invitationCode } = await createInvitation({ applicantId: "app1", invitedName: "Ammi", invitedEmail: "ammi@example.com", relationship: "Parent" });
    const inv = invitations.get(invitationCode)!;
    await expect(revokeInvitation(inv.id, "someone-else")).rejects.toThrow(FamilyInvitationError);
    expect(invitations.get(invitationCode)!.status).toBe("SENT");
  });
});
