import { describe, it, expect, vi, beforeEach } from "vitest";

let created: Record<string, unknown>[];

vi.mock("@/lib/privacy/data-classification", () => ({ classify: vi.fn((field: string) => (field === "mobileNumber" ? "CONTACT_DATA" : "PROFILE_DATA")) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    privacyAccessLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `log${created.length}`, ...data };
      }),
    },
  },
}));

const { logPrivacyAccess } = await import("./access-log");

beforeEach(() => {
  created = [];
});

describe("logPrivacyAccess", () => {
  it("records an access with no purpose when none is given — unchanged, non-gating behavior", async () => {
    await logPrivacyAccess({ actorAdminId: "admin1", action: "CONTACT_VIEWED", field: "mobileNumber", targetProfileId: "p1" });
    expect(created[0]).toMatchObject({ purpose: null, dataCategory: "CONTACT_DATA" });
  });

  it("records the given purpose when provided", async () => {
    await logPrivacyAccess({ actorAdminId: "admin1", action: "CONTACT_VIEWED", field: "mobileNumber", targetProfileId: "p1", purpose: "CONTACT_SHARING" as never });
    expect(created[0]).toMatchObject({ purpose: "CONTACT_SHARING" });
  });
});
