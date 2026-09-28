import { describe, it, expect, vi, beforeEach } from "vitest";

let signedInAs: string | null;
let limited: { status: number } | null;
const submitted: Array<Record<string, unknown>> = [];
const listed: string[] = [];

vi.mock("@/lib/require-applicant", () => ({ requireApplicantProfileId: vi.fn(async () => signedInAs) }));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: vi.fn(async () => limited) }));
vi.mock("@/lib/risk/report-service", () => ({
  submitUserReport: vi.fn(async (p: Record<string, unknown>) => {
    submitted.push(p);
    return { reportCode: "LPP-REPORT-000001", status: "RECEIVED", duplicate: false };
  }),
  listOwnReports: vi.fn(async (id: string) => {
    listed.push(id);
    return [{ reportCode: "LPP-REPORT-000001", reportType: "OTHER", status: "RECEIVED" }];
  }),
}));

const { POST, GET } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x.test/api/my-reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  signedInAs = "me";
  limited = null;
  submitted.length = 0;
  listed.length = 0;
});

describe("/api/my-reports", () => {
  it("requires an applicant session (401) for both POST and GET", async () => {
    signedInAs = null;
    expect((await post({ reportType: "OTHER", description: "long enough description" })).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(submitted).toHaveLength(0);
  });

  it("is rate limited before anything else happens", async () => {
    limited = { status: 429 };
    const res = await post({ reportType: "OTHER", description: "long enough description" });
    expect(res.status).toBe(429);
    expect(submitted).toHaveLength(0);
  });

  it("IDOR: the reporter is ALWAYS the session's profile, whatever the body claims", async () => {
    await post({ reportType: "OTHER", description: "long enough description", reporterProfileId: "victim", profileId: "victim", reportedProfileCode: "LPP-000002" });
    expect(submitted[0]).toMatchObject({ reporterProfileId: "me", reportedProfileCode: "LPP-000002" });
    expect(JSON.stringify(submitted[0])).not.toContain("victim");
  });

  it("GET lists only the signed-in applicant's own reports", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listed).toEqual(["me"]);
  });

  it("the response is neutral: a code, a status and a thank-you, nothing about the reported profile or any risk data", async () => {
    const res = await post({ reportType: "OTHER", description: "long enough description", reportedProfileCode: "LPP-000002" });
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["message", "reportCode", "status"]);
    expect(JSON.stringify(json)).not.toMatch(/risk|score|signal|duplicate|LPP-000002/i);
  });

  it("malformed JSON is a 400, not a 500", async () => {
    const res = await POST(new Request("http://x.test/api/my-reports", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });
});
