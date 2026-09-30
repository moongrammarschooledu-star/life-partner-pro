import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeCrmRecord {
  id: string;
  profileId: string;
  lifecycleStage: string;
}

let record: FakeCrmRecord | null = null;
const historyRows: Array<{ crmRecordId: string; fromStage: string | null; toStage: string; triggeredBy: string }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    crmRecord: {
      findUnique: vi.fn(async () => record),
      update: vi.fn(async ({ data }: { data: { lifecycleStage: string } }) => {
        if (record) record.lifecycleStage = data.lifecycleStage;
        return record;
      }),
    },
    crmLifecycleHistory: {
      create: vi.fn(async ({ data }: { data: { crmRecordId: string; fromStage: string | null; toStage: string; triggeredBy: string } }) => {
        historyRows.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { syncCrmStageFromProfileStatus, syncCrmStageOnVerification } from "./profile-status-sync";

beforeEach(() => {
  record = { id: "crm-1", profileId: "profile-1", lifecycleStage: "ACTIVE" };
  historyRows.length = 0;
});

describe("syncCrmStageFromProfileStatus (STEP 28 §1 — one-way, best-effort, never-throw)", () => {
  it("advances the CRM stage when the mapped status is a valid forward transition", async () => {
    await syncCrmStageFromProfileStatus("profile-1", "SUSPENDED");
    expect(record!.lifecycleStage).toBe("SUSPENDED");
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].triggeredBy).toBe("PROFILE_STATUS_SYNC");
  });

  it("silently no-ops when no CRM record exists for the profile", async () => {
    record = null;
    await expect(syncCrmStageFromProfileStatus("profile-1", "SUSPENDED")).resolves.toBeUndefined();
    expect(historyRows).toHaveLength(0);
  });

  it("silently no-ops when the status has no mapped CRM stage", async () => {
    await syncCrmStageFromProfileStatus("profile-1", "PENDING" as never);
    expect(record!.lifecycleStage).toBe("ACTIVE");
    expect(historyRows).toHaveLength(0);
  });

  it("silently no-ops when the mapped stage is already the current stage", async () => {
    await syncCrmStageFromProfileStatus("profile-1", "ACTIVE");
    expect(historyRows).toHaveLength(0);
  });

  it("silently no-ops when the mapped stage would be an invalid transition (never throws)", async () => {
    record!.lifecycleStage = "ARCHIVED"; // terminal — no transition is ever valid from here
    await expect(syncCrmStageFromProfileStatus("profile-1", "ACTIVE")).resolves.toBeUndefined();
    expect(record!.lifecycleStage).toBe("ARCHIVED");
    expect(historyRows).toHaveLength(0);
  });
});

describe("syncCrmStageOnVerification", () => {
  it("moves the CRM record to VERIFIED (VERIFIED precedes ACTIVE on the forward path, so this starts one stage earlier)", async () => {
    record!.lifecycleStage = "VERIFICATION_PENDING";
    await syncCrmStageOnVerification("profile-1");
    expect(record!.lifecycleStage).toBe("VERIFIED");
  });

  it("no-ops when already VERIFIED", async () => {
    record!.lifecycleStage = "VERIFIED";
    await syncCrmStageOnVerification("profile-1");
    expect(historyRows).toHaveLength(0);
  });

  it("never throws when no CRM record exists", async () => {
    record = null;
    await expect(syncCrmStageOnVerification("profile-1")).resolves.toBeUndefined();
  });
});
