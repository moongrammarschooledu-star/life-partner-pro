import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- fixtures ----------
interface FakeProfile {
  id: string; profileCode: string; fullName: string; gender: "MALE" | "FEMALE"; dateOfBirth: Date;
  city: string; country: string; area: string | null; maritalStatus: string; heightCm: number;
  status: string; verified: boolean; softDeleted: boolean; accountStatus: string; profileCompletion: number;
  createdAt: Date; updatedAt: Date;
  education?: { level: string } | null; profession?: { profession: string; monthlyIncome: number | null } | null;
  family?: unknown; lifestyle?: unknown; preference?: unknown; photos: Array<{ id: string; isPrimary: boolean }>;
}

let profiles: Map<string, FakeProfile>;
let assignedIdsByRole: string[] | null; // controlled per test via mocked getAssignedResourceIds
let shortlists: Map<string, { id: string; ownerId: string; status: string }>;
let shortlistItems: Map<string, { id: string; shortlistId: string; profileId: string; adminNote: string | null }>;
let savedSearches: Map<string, { id: string; ownerId: string; visibility: string }>;
let idCounter = 0;
function nextId(prefix: string) { idCounter += 1; return `${prefix}${idCounter}`; }

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/search/audit", () => ({ recordSearchEvent: vi.fn(async () => {}), recordSensitiveSearchEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-000001`) }));
vi.mock("@/lib/ai/match-config", () => ({
  loadMatchConfig: vi.fn(async () => ({ weights: { age: 15, location: 15, education: 10, profession: 10, income: 10, maritalStatus: 10, height: 5, family: 10, religious: 10, lifestyle: 5, languages: 5 }, hardRequirements: {}, enabled: {} })),
}));
vi.mock("@/lib/admin-assignment", () => ({ getAssignedResourceIds: vi.fn(async () => assignedIdsByRole) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: {
      findMany: vi.fn(async ({ where }: { where: { AND?: unknown[] } }) => {
        return [...profiles.values()].filter((p) => matchesAnd(p, where?.AND ?? []));
      }),
      count: vi.fn(async ({ where }: { where: { AND?: unknown[] } }) => [...profiles.values()].filter((p) => matchesAnd(p, where?.AND ?? [])).length),
      findFirst: vi.fn(async ({ where }: { where: { AND?: unknown[] } }) => {
        const found = [...profiles.values()].filter((p) => matchesAnd(p, where?.AND ?? []));
        return found[0] ? { ...found[0] } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = profiles.get(where.id);
        return p ? { ...p } : null;
      }),
    },
    adminAssignment: { findMany: vi.fn(async () => []) },
    shortlist: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("short");
        const row = { id, ownerId: data.ownerId as string, status: "DRAFT" };
        shortlists.set(id, row);
        return { ...row, items: [] };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = shortlists.get(where.id);
        return s ? { ...s } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = shortlists.get(where.id)!;
        Object.assign(s, data);
        return { ...s };
      }),
    },
    shortlistItem: {
      upsert: vi.fn(async ({ where, create }: { where: { shortlistId_profileId: { shortlistId: string; profileId: string } }; create: Record<string, unknown> }) => {
        const key = `${where.shortlistId_profileId.shortlistId}:${where.shortlistId_profileId.profileId}`;
        if (shortlistItems.has(key)) return { ...shortlistItems.get(key)! };
        const id = nextId("item");
        const row = { id, shortlistId: create.shortlistId as string, profileId: create.profileId as string, adminNote: (create.adminNote as string) ?? null };
        shortlistItems.set(key, row);
        return { ...row };
      }),
      delete: vi.fn(async () => ({})),
    },
    savedSearch: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("saved");
        const row = { id, ownerId: data.ownerId as string, visibility: (data.visibility as string) ?? "PRIVATE" };
        savedSearches.set(id, row);
        return { ...row };
      }),
      findMany: vi.fn(async () => [...savedSearches.values()]),
    },
    adminUser: { findUnique: vi.fn(async () => ({ departmentId: null })) },
  },
}));

function matchesAnd(profile: FakeProfile, and: unknown[]): boolean {
  return and.every((clause) => matchesClause(profile, clause as Record<string, unknown>));
}
function matchesClause(profile: FakeProfile, clause: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(clause)) {
    if (key === "AND") return matchesAnd(profile, value as unknown[]);
    if (key === "OR") return (value as Record<string, unknown>[]).some((c) => matchesClause(profile, c));
    if (key === "id" && value && typeof value === "object" && "in" in (value as object)) {
      if (!(value as { in: string[] }).in.includes(profile.id)) return false;
      continue;
    }
    if (key === "status" && value && typeof value === "object" && "notIn" in (value as object)) {
      if ((value as { notIn: string[] }).notIn.includes(profile.status)) return false;
      continue;
    }
    if (key === "restrictions" || key === "verification" || key === "followUps") continue; // not modeled in this fixture set
    const actual = (profile as unknown as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !("getTime" in (value as object))) {
      const v = value as { equals?: unknown; mode?: string; contains?: string };
      if ("equals" in v) {
        const a = v.mode === "insensitive" && typeof actual === "string" ? actual.toLowerCase() : actual;
        const b = v.mode === "insensitive" && typeof v.equals === "string" ? v.equals.toLowerCase() : v.equals;
        if (a !== b) return false;
        continue;
      }
      if ("contains" in v) {
        if (typeof actual !== "string" || !actual.toLowerCase().includes(String(v.contains).toLowerCase())) return false;
        continue;
      }
      continue; // other scalar filter shapes (gte/lte/in on non-id fields) — not exercised by these tests
    }
    if (actual !== value) return false;
  }
  return true;
}

function fakeProfile(overrides: Partial<FakeProfile> & { id: string }): FakeProfile {
  return {
    profileCode: `LPP-${overrides.id}`,
    fullName: "Test",
    gender: "FEMALE",
    dateOfBirth: new Date("1998-01-01"),
    city: "Lahore",
    country: "Pakistan",
    area: null,
    maritalStatus: "NEVER_MARRIED",
    heightCm: 165,
    status: "ACTIVE",
    verified: true,
    softDeleted: false,
    accountStatus: "ACTIVE",
    profileCompletion: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
    education: { level: "Bachelors" },
    profession: { profession: "Teacher", monthlyIncome: 50000 },
    photos: [],
    ...overrides,
  };
}

function admin(overrides: Partial<{ id: string; role: string; permissions: string[] }> = {}) {
  return { id: overrides.id ?? "admin1", role: (overrides.role ?? "STAFF_MATCHMAKER") as never, permissions: (overrides.permissions ?? ["search:view", "candidate:view", "candidate:shortlist", "candidate:compare"]) as never, name: "A", email: "a@a.com", sid: "sid1" };
}

// ---------- module under test ----------
import { searchProfiles, searchByProfileId, compareCandidates, createShortlist, addToShortlist, saveSearchPreset, SearchError } from "@/lib/search/candidate-search";

beforeEach(() => {
  profiles = new Map();
  shortlists = new Map();
  shortlistItems = new Map();
  savedSearches = new Map();
  assignedIdsByRole = null;
  idCounter = 0;

  profiles.set("p1", fakeProfile({ id: "p1" }));
  profiles.set("p2", fakeProfile({ id: "p2" }));
  profiles.set("p3", fakeProfile({ id: "p3", status: "SUSPENDED" }));
});

describe("searchProfiles — permission gate", () => {
  it("rejects a caller without search:view", async () => {
    await expect(searchProfiles(admin({ permissions: [] }), {})).rejects.toThrow(SearchError);
  });
});

describe("searchProfiles — assignment scoping (spec §32)", () => {
  it("scopes results to only the caller's assigned profiles for a non-broad role", async () => {
    assignedIdsByRole = ["p1"]; // p2 exists but is NOT assigned to this admin
    const result = await searchProfiles(admin(), {});
    expect(result.items.map((i) => i.id)).toEqual(["p1"]);
  });

  it("returns an empty result (not an error, not everything) when the staff member has no assignments at all", async () => {
    assignedIdsByRole = [];
    const result = await searchProfiles(admin(), {});
    expect(result.items).toHaveLength(0);
  });

  it("does not scope results for a broad-access role", async () => {
    assignedIdsByRole = null; // getAssignedResourceIds returns null for broad roles
    const result = await searchProfiles(admin({ role: "SUPER_ADMIN" }), {});
    expect(result.items.map((i) => i.id).sort()).toEqual(["p1", "p2"]); // p3 excluded by default SUSPENDED filter
  });
});

describe("searchProfiles — default safety exclusions (spec §31)", () => {
  it("excludes SUSPENDED profiles by default", async () => {
    assignedIdsByRole = null;
    const result = await searchProfiles(admin({ role: "SUPER_ADMIN" }), {});
    expect(result.items.some((i) => i.id === "p3")).toBe(false);
  });
});

describe("searchByProfileId — IDOR / enumeration protection (spec §4/§52)", () => {
  it("returns null identically for a nonexistent profile code", async () => {
    const result = await searchByProfileId(admin(), "LPP-DOES-NOT-EXIST");
    expect(result).toBeNull();
  });

  it("returns null identically for a profile that exists but is outside the caller's assignment scope", async () => {
    assignedIdsByRole = ["p1"]; // p2 exists, but not assigned
    const result = await searchByProfileId(admin(), profiles.get("p2")!.profileCode);
    expect(result).toBeNull();
  });

  it("returns the candidate when it exists and is authorized", async () => {
    assignedIdsByRole = ["p1"];
    const result = await searchByProfileId(admin(), profiles.get("p1")!.profileCode);
    expect(result?.id).toBe("p1");
  });
});

describe("searchProfiles — sensitive income filter permission gate (spec §11)", () => {
  it("rejects an income filter without sensitive:income:view + search:sensitive", async () => {
    await expect(searchProfiles(admin(), { minIncome: 50000 })).rejects.toThrow(/permission to search by income/);
  });

  it("allows an income filter with both permissions", async () => {
    assignedIdsByRole = null;
    const a = admin({ role: "SUPER_ADMIN", permissions: ["search:view", "sensitive:income:view", "search:sensitive"] });
    await expect(searchProfiles(a, { minIncome: 1 })).resolves.toBeDefined();
  });
});

describe("searchProfiles — advanced filter requires search:advanced (spec §33)", () => {
  it("rejects a filterGroup from a caller without search:advanced or a broad role", async () => {
    await expect(searchProfiles(admin({ role: "SUPPORT_STAFF", permissions: ["search:view"] }), { filterGroup: { op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] } })).rejects.toThrow(SearchError);
  });
});

describe("compareCandidates — caps and assignment IDOR", () => {
  it("rejects fewer than 2 candidates", async () => {
    await expect(compareCandidates(admin(), ["p1"])).rejects.toThrow(/at least 2/);
  });

  it("rejects more than the max comparison count", async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `p${i}`);
    for (const id of ids) profiles.set(id, fakeProfile({ id }));
    await expect(compareCandidates(admin({ role: "SUPER_ADMIN" }), ids)).rejects.toThrow(/at most/);
  });

  it("rejects comparing a profile outside the caller's assignment scope (IDOR)", async () => {
    assignedIdsByRole = ["p1"]; // p2 not assigned
    await expect(compareCandidates(admin(), ["p1", "p2"])).rejects.toThrow(/not assigned to you/);
  });
});

describe("createShortlist / addToShortlist — duplicate-add idempotency (spec §45)", () => {
  it("adding the same candidate twice does not create a second row", async () => {
    const a = admin();
    const shortlist = await createShortlist(a, { name: "My List" });
    await addToShortlist(a, shortlist.id, "p1");
    await addToShortlist(a, shortlist.id, "p1");
    expect(shortlistItems.size).toBe(1);
  });

  it("caps bulk profileIds at the configured maximum on creation", async () => {
    const a = admin();
    const ids = Array.from({ length: 150 }, (_, i) => `bulk${i}`);
    const shortlist = await createShortlist(a, { name: "Big List", profileIds: ids });
    expect(shortlist.items.length).toBeLessThanOrEqual(100);
  });
});

describe("saveSearchPreset — shared visibility requires search:saved:edit", () => {
  it("rejects creating a TEAM-visible preset without search:saved:edit", async () => {
    const a = admin({ permissions: ["search:saved:create"] });
    await expect(saveSearchPreset(a, { name: "x", filterGroup: { op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] }, visibility: "TEAM" })).rejects.toThrow(/shared preset/);
  });

  it("allows a PRIVATE preset without search:saved:edit", async () => {
    const a = admin({ permissions: ["search:saved:create"] });
    await expect(saveSearchPreset(a, { name: "x", filterGroup: { op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] } })).resolves.toBeDefined();
  });

  it("rejects a preset filterGroup with an unknown field (never persists an unvalidated filter)", async () => {
    const a = admin({ permissions: ["search:saved:create"] });
    await expect(saveSearchPreset(a, { name: "x", filterGroup: { op: "AND", rules: [{ field: "$injected", op: "eq", value: "x" }] } })).rejects.toThrow();
  });
});
