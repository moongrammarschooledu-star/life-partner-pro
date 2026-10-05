import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

// STEP 30 §63/§64 — structure and privilege checks done on the source itself: every new route is guarded, an applicant can only
// ever reach their own data, the internal activity figure is confined to staff, the AI builder cannot send/approve/decide,
// and the only code that can message an applicant is the single delivery gate.

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(SRC, p).replace(/\\/g, "/");
// source with comments removed, so a check looks at what the code does rather than what a comment says
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const API = join(SRC, "app", "api");
const adminRoutes = walk(join(API, "admin", "engagement")).filter((p) => p.endsWith("route.ts"));
const applicantRoutes = ["my-engagement", "my-guide", "my-feedback"].flatMap((d) => walk(join(API, d)).filter((p) => p.endsWith("route.ts")));
const engagementLib = walk(join(SRC, "lib", "engagement")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));

describe("routes are guarded", () => {
  it("there are admin and applicant routes to check", () => {
    expect(adminRoutes.length).toBeGreaterThan(20);
    expect(applicantRoutes.length).toBeGreaterThan(8);
  });

  it("every admin route authorises with requireAdmin(", () => {
    for (const r of adminRoutes) expect(read(r), rel(r)).toMatch(/requireAdmin\(/);
  });

  it("every state-changing admin route names a permission (no bare requireAdmin() except the AI route, whose pipeline checks it)", () => {
    for (const r of adminRoutes) {
      const src = read(r);
      if (/export (async function|const) (POST|PATCH|PUT|DELETE)/.test(src) && !rel(r).includes("ai/assist")) expect(src, rel(r)).toMatch(/requireAdmin\((?!\))/);
    }
  });

  it("the AI route is rate-limited and permission-checked by the AI pipeline", () => {
    const features = read(join(SRC, "lib", "ai", "availability.ts"));
    expect(features).toMatch(/ENGAGEMENT_ASSISTANT: "ai:engagement:use"/);
    expect(features).toMatch(/ENGAGEMENT_ASSISTANT: "ai\.engagement_assistant\.enabled"/);
  });

  it("every applicant route verifies the applicant session", () => {
    for (const r of applicantRoutes) expect(read(r), rel(r)).toMatch(/requireApplicantProfileId\(/);
  });

  it("applicant routes take the profile from the session, never from the request", () => {
    for (const r of applicantRoutes) {
      const src = read(r);
      expect(src, rel(r)).not.toMatch(/searchParams\.get\(["']profileId["']\)/);
      expect(src, rel(r)).not.toMatch(/body\??\.profileId|\.profileId\s*\?\?\s*profileId/);
    }
  });

  it("route files export only HTTP handlers and route config", () => {
    const allowed = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|dynamic|revalidate|runtime|maxDuration|fetchCache|preferredRegion)$/;
    for (const r of [...adminRoutes, ...applicantRoutes]) {
      for (const m of read(r).matchAll(/^export (?:async function|const|function|let|var|class) (\w+)/gm)) expect(m[1], rel(r)).toMatch(allowed);
    }
  });

  it("the applicant-facing responses never include staff-only fields", () => {
    const sources = applicantRoutes.map(read).join("\n") + read(join(SRC, "lib", "engagement", "feedback-service.ts"));
    const mine = read(join(SRC, "lib", "engagement", "feedback-service.ts")).match(/export async function listMyFeedback[\s\S]*?\n}\n/)?.[0] ?? "";
    expect(mine).toContain("select:");
    expect(mine).not.toMatch(/internalNote|handledById/);
    expect(applicantRoutes.map(read).join("\n")).not.toMatch(/internalNote|activityScore|computeActivityScore/);
    expect(sources.length).toBeGreaterThan(0);
  });
});

describe("the activity figure stays with staff", () => {
  const importsScore = (src: string) => /activity-score/.test(src);

  it("is imported only by the staff applicant view, the read-model consumers that need a band, and the pure modules/tests", () => {
    const importers = engagementLib.concat(walk(API).filter((p) => p.endsWith(".ts")), walk(join(SRC, "app")).filter((p) => p.endsWith(".tsx")), walk(join(SRC, "lib", "ai")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts")))
      .filter((p) => !p.endsWith("activity-score.ts") && importsScore(read(p))).map(rel).sort();
    expect(importers).toEqual(["app/api/admin/engagement/users/[id]/route.ts", "lib/engagement/eligibility.ts", "lib/engagement/reengagement.ts"].sort());
  });

  it("is never available to workflow conditions, targeting, exports or the AI", () => {
    for (const f of ["workflow-schema.ts", "announcement-service.ts", "analytics.ts"]) expect(read(join(SRC, "lib", "engagement", f)), f).not.toMatch(/computeActivityScore|activityScore/);
    expect(read(join(SRC, "lib", "ai", "analysis", "engagement-assistant.ts"))).not.toMatch(/computeActivityScore|activityScore/);
    expect(code(join(API, "admin", "engagement", "analytics", "export", "route.ts"))).not.toMatch(/computeActivityScore|activity-score/);
    expect(read(join(SRC, "lib", "ai", "profile-view.ts"))).toMatch(/ENGAGEMENT_ASSISTANT:[\s\S]*?activityScore/);
  });
});

describe("only the delivery gate (and the workflow family notice) can message an applicant", () => {
  it("sendNotification is imported by exactly deliver.ts and workflow-runner.ts", () => {
    const users = engagementLib.filter((p) => /notification-service/.test(read(p))).map((p) => rel(p).replace("lib/engagement/", "")).sort();
    expect(users).toEqual(["deliver.ts", "workflow-runner.ts"]);
  });

  it("the runner sends to the applicant only by way of deliverReminder", () => {
    const runner = read(join(SRC, "lib", "engagement", "workflow-runner.ts"));
    const direct = [...runner.matchAll(/sendNotification\(([^)]*)\)/g)].map((m) => m[1]);
    // the only direct call is the family notice, which is in-app only and gated by canAccessRecord
    expect(direct).toHaveLength(1);
    expect(runner).toMatch(/canAccessRecord/);
    expect(runner).toMatch(/deliverReminder/);
  });

  it("the delivery gate checks flags, restrictions, preferences, suppression, need, limits and quiet hours before sending", () => {
    const whole = code(join(SRC, "lib", "engagement", "deliver.ts"));
    const d = whole.slice(whole.indexOf("export async function deliverReminder"));
    const order = ["isFeatureEnabled(ENGAGEMENT_FLAGS.master)", "profileMayReceiveEngagement", "hasActiveRestriction", "remindersEnabled", "communicationSuppression", "stillNeeded", "decideFrequency", "isWithinQuietHours", "sendNotification("].map((s) => d.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("the AI builder cannot act", () => {
  const builder = code(join(SRC, "lib", "ai", "analysis", "engagement-assistant.ts"));
  const imports = [...builder.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();

  it("imports only pure engagement modules and types", () => {
    expect(imports).toEqual(["@/lib/ai/types", "@/lib/engagement/content-scan", "@/lib/engagement/journey", "@/lib/engagement/next-action", "@/lib/engagement/phrases", "@/lib/engagement/types"].sort());
  });

  it("has no way to send, schedule, approve, suspend, share contact details or touch money or proposals", () => {
    for (const bad of ["sendNotification", "scheduleReminder", "deliverReminder", "prisma", "enforceApprovalGate", "suspend", "contact-permission", "finance", "transitionStage", "createFromEvent"]) expect(builder, bad).not.toContain(bad);
  });

  it("is a deterministic builder: no model call exists in it", () => {
    expect(builder).not.toMatch(/fetch\(|openai|anthropic|completions?\.create/i);
  });
});

describe("no hard-coded limits and no tracking", () => {
  it("frequency limits come from settings, never literals in the gate", () => {
    const d = read(join(SRC, "lib", "engagement", "deliver.ts"));
    expect(d).toMatch(/settings\.maxWeeklyReengagement/);
    expect(d).toMatch(/settings\.reminderMinGapHours/);
    expect(d).toMatch(/limits\.dailyMax/);
    expect(d).not.toMatch(/dailyMax:\s*\d/);
  });

  it("collects no pixel/click tracking", () => {
    for (const p of engagementLib) expect(read(p), rel(p)).not.toMatch(/tracking pixel|<img[^>]+track|open\.gif|utm_/i);
  });

  it("the new tables and every engagement store appear in the retention module or are aggregate-only", () => {
    const r = read(join(SRC, "lib", "engagement", "retention.ts"));
    for (const t of ["engagementEvent", "engagementReminder", "engagementWorkflowRun", "engagementFeedback"]) expect(r, t).toContain(t);
    expect(r).toMatch(/hasActiveHold/);
    expect(r).toMatch(/absent policy = keep/);
  });
});

describe("registration of the new work in shared places", () => {
  it("the daily tick, retention sweep and rate limits include the engagement parts", () => {
    expect(read(join(SRC, "lib", "ops", "scheduler.ts"))).toMatch(/engagement-lifecycle/);
    expect(read(join(SRC, "lib", "privacy", "retention-policy.ts"))).toMatch(/engagement\/retention/);
    const limits = read(join(SRC, "lib", "security", "rate-limit-policy.ts"));
    expect(limits).toMatch(/"engagement-feedback"/);
    expect(limits).toMatch(/"engagement-preferences"/);
  });

  it("publishing goes through the approval gate and a reviewer different from the author", () => {
    for (const f of ["workflow-service.ts", "content-service.ts", "announcement-service.ts"]) {
      const src = read(join(SRC, "lib", "engagement", f));
      expect(src, f).toMatch(/gateEngagementAction\(/);
      expect(src, f).toMatch(/assertApprovedPayloadMatches\(/);
      expect(src, f).toMatch(/actor\.id === (v|a)\.(authorId|createdById)/);
    }
  });

  it("the engagement event taps in existing modules never throw into the caller", () => {
    const tap = read(join(SRC, "lib", "engagement", "tap.ts"));
    expect(tap).toMatch(/try \{[\s\S]*catch/);
    const events = read(join(SRC, "lib", "engagement", "events.ts"));
    expect(events).toMatch(/export async function recordEngagementEvent[\s\S]*?catch \(error\)[\s\S]*?return \{ recorded: false \}/);
  });
});
