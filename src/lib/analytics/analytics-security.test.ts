import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { METRICS } from "@/lib/analytics/metrics/registry";

// STEP 31 §72 — structure and privilege checks done on the source itself: every analytics route is guarded and names a permission,
// no analytics code can run caller-supplied SQL, the AI path cannot query or act, money is never floating point, the existing report
// routes were left alone, and the new jobs/limits/flags are registered.

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
const routes = [...walk(join(API, "admin", "analytics")), ...walk(join(API, "admin", "executive"))].filter((p) => p.endsWith("route.ts"));
const analyticsLib = walk(join(SRC, "lib", "analytics")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
const isAssistantRoute = (p: string) => rel(p).endsWith("analytics/assistant/route.ts");

describe("routes are guarded", () => {
  it("there are routes to check", () => {
    expect(routes.length).toBeGreaterThanOrEqual(30);
  });

  it("every route authorises with requireAdmin(", () => {
    for (const r of routes) expect(read(r), rel(r)).toMatch(/requireAdmin\(/);
  });

  it("every route names an analytics permission (never a bare requireAdmin()), except the assistant (its AI pipeline checks ai:analytics:use)", () => {
    for (const r of routes) {
      if (isAssistantRoute(r)) continue;
      const src = code(r);
      expect(src, rel(r)).not.toMatch(/requireAdmin\(\s*\)/);
      expect(src, rel(r)).toMatch(/["'`]analytics:[a-z_:]+["'`]/); // the permission, directly or in a per-action map
    }
  });

  it("every route checks the analytics feature switch, except the assistant (its own AI switch is checked by the AI pipeline) and the home route (which only reports which switches are on)", () => {
    for (const r of routes) {
      // the home route only reports which switches are on; settings must be editable (timezone, small-group size) before anything is switched on
      if (isAssistantRoute(r) || ["app/api/admin/analytics/route.ts", "app/api/admin/analytics/settings/route.ts"].includes(rel(r))) continue;
      expect(read(r), rel(r)).toMatch(/assertEnabled\(/);
    }
  });

  it("the assistant is gated by the AI pipeline, not by a bare route", () => {
    const route = read(routes.find(isAssistantRoute)!);
    expect(route).toMatch(/runAnalyticsAssistant\(/);
    const availability = read(join(SRC, "lib", "ai", "availability.ts"));
    expect(availability).toMatch(/ANALYTICS_ASSISTANT: "ai:analytics:use"/);
    expect(availability).toMatch(/ANALYTICS_ASSISTANT: "ai\.analytics_assistant\.enabled"/);
  });

  it("route files export only HTTP handlers and route config", () => {
    const allowed = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|dynamic|revalidate|runtime|maxDuration|fetchCache|preferredRegion)$/;
    for (const r of routes) {
      for (const m of read(r).matchAll(/^export (?:async function|const|function|let|var|class) (\w+)/gm)) expect(m[1], rel(r)).toMatch(allowed);
    }
  });

  it("state-changing routes never accept a user id from the request body as the actor", () => {
    for (const r of routes) expect(code(r), rel(r)).not.toMatch(/body\??\.(actorId|adminId|ownerId|createdById)/);
  });
});

describe("no analytics code can run caller-supplied SQL", () => {
  const files = [...analyticsLib, ...routes, join(SRC, "lib", "ai", "analysis", "analytics-assistant.ts")];

  it("uses no unsafe raw query and no Prisma.raw anywhere", () => {
    for (const f of files) {
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|\$executeRaw\b|Prisma\.raw\(/);
    }
  });

  it("every $queryRaw is given a Prisma.sql template (parameterised), never a plain string", () => {
    const users = files.filter((f) => /\$queryRaw/.test(code(f)));
    expect(users.length).toBeGreaterThan(3);
    for (const f of users) {
      const src = code(f);
      expect(src, rel(f)).toMatch(/Prisma\.sql`/);
      expect(src, rel(f)).not.toMatch(/\$queryRaw(<[^(]*>)?\(\s*["'`]/); // a string/template literal passed straight in
    }
    for (const u of users.map(rel)) expect(u).toMatch(/^lib\/analytics\/(data-quality|cohorts)\.ts$|^lib\/analytics\/metrics\//);
  });

  it("the query schema is closed: unknown keys are rejected and there is no free-text field", () => {
    const src = read(join(SRC, "lib", "analytics", "query.ts"));
    expect(src).toMatch(/\.strict\(\)/);
    expect(code(join(SRC, "lib", "analytics", "query.ts"))).not.toMatch(/sql\s*:|rawQuery|\bwhereRaw\b/i);
  });

  it("metric dimensions and filters come from the catalog, never from the request", () => {
    for (const m of METRICS) expect(m.dimensions.every((d) => /^[a-z_]+$/.test(d)), m.key).toBe(true);
  });
});

describe("the AI path cannot query or act", () => {
  const builderPath = join(SRC, "lib", "ai", "analysis", "analytics-assistant.ts");
  const builder = code(builderPath);
  const imports = [...builder.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();

  it("the AI builder imports only AI types and the pure explanation type", () => {
    expect(imports).toEqual(["@/lib/ai/types", "@/lib/analytics/assistant"].sort());
  });

  it("the AI builder has no database, messaging, approval, finance or provider access", () => {
    for (const bad of ["prisma", "sendNotification", "fetch(", "enforceApprovalGate", "finance", "openai", "anthropic", "$queryRaw", "writeAudit"]) expect(builder, bad).not.toContain(bad);
  });

  it("the question parser is pure: it imports no database or network code", () => {
    const src = code(join(SRC, "lib", "analytics", "assistant.ts"));
    expect(src).not.toMatch(/@\/lib\/prisma|@prisma\/client|fetch\(|sendNotification|writeAudit/);
    const imports2 = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports2).toEqual(["@/lib/analytics/metrics/registry", "@/lib/analytics/query", "@/lib/analytics/time", "@/lib/analytics/types"].sort());
  });

  it("the assistant entry point sends the parsed structured query through the same engine as every dashboard", () => {
    const src = read(join(SRC, "lib", "ai", "features.ts"));
    const block = src.slice(src.indexOf("export async function runAnalyticsAssistant"));
    expect(block).toMatch(/parseQuestion\(/);
    expect(block).toMatch(/runAnalyticsQuery\(/);
    expect(block).not.toMatch(/\$queryRaw|prisma\.\$/);
  });

  it("no wording that treats a matching score as a chance of marriage is used anywhere in analytics", () => {
    const sources = [...analyticsLib, join(SRC, "lib", "ai", "analysis", "analytics-assistant.ts")].map(code).join("\n");
    expect(sources).not.toMatch(/(?<!never a )(marriage probability|probability of marriage|chance of marriage|success probability)|best applicants?|top applicants?/i);
    for (const m of METRICS.filter((x) => x.key.startsWith("matching."))) expect(`${m.name} ${m.synonyms.join(" ")}`, m.key).not.toMatch(/probab|likelihood|success rate|chance/i); // names may deny it in their description, never claim it
  });
});

describe("money is integer minor units", () => {
  it("the money metrics use no floating-point arithmetic", () => {
    const src = code(join(SRC, "lib", "analytics", "metrics", "money-domains.ts"));
    expect(src).not.toMatch(/parseFloat|toFixed\(|Math\.round\(|Number\(\s*[^)]*\)\s*\*\s*100|\*\s*0\.\d|\/\s*100\b/);
  });

  it("the stored value columns are integers", () => {
    const schema = read(join(ROOT, "prisma", "schema.prisma"));
    const model = schema.slice(schema.indexOf("model AnalyticsDailyMetric"), schema.indexOf("model AnalyticsMart"));
    expect(model).toMatch(/value\s+BigInt/);
    expect(model).not.toMatch(/\b(Float|Decimal)\b/);
  });
});

describe("the existing reports were left alone", () => {
  it("the analytics routes do not live under /api/admin/reports", () => {
    expect(routes.some((r) => rel(r).startsWith("app/api/admin/reports/"))).toBe(false);
  });

  it("the old report routes still exist and still authorise with requireAdmin(", () => {
    const old = walk(join(API, "admin", "reports")).filter((p) => p.endsWith("route.ts"));
    expect(old.length).toBeGreaterThan(5);
    for (const r of old) expect(read(r), rel(r)).toMatch(/requireAdmin\(/);
  });

  it("analytics code never writes to an operational table", () => {
    const writes = /prisma\.(?!analytics|retentionActionLog|\$)(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    for (const f of analyticsLib) expect(code(f), rel(f)).not.toMatch(writes);
  });
});

describe("registration", () => {
  it("the pipeline runs from the daily tick and as a background job", () => {
    expect(read(join(SRC, "lib", "ops", "scheduler.ts"))).toMatch(/runCronTask\("analytics-pipeline"/);
    expect(read(join(SRC, "lib", "ops", "jobs.ts"))).toMatch(/ANALYTICS_REBUILD/);
    expect(read(join(SRC, "lib", "ops", "job-handlers.ts"))).toMatch(/analyticsRebuildHandler/);
  });

  it("the new switches default to off and the analytics. prefix is registered as default-off", () => {
    const defs = read(join(SRC, "lib", "ops", "feature-flag-defs.ts"));
    for (const k of ["analytics.enabled", "analytics.pipeline.enabled", "analytics.reports.enabled", "analytics.scheduled_reports.enabled", "analytics.alerts.enabled", "analytics.forecast.enabled", "ai.analytics_assistant.enabled"]) expect(defs, k).toContain(k);
    expect(defs).toMatch(/"analytics\."/);
  });

  it("exports, queries and the assistant are rate limited", () => {
    const policy = read(join(SRC, "lib", "security", "rate-limit-policy.ts"));
    for (const k of ["analytics-query", "analytics-export", "analytics-assistant"]) expect(policy, k).toContain(`"${k}"`);
  });

  it("the access log is covered by the retention sweep", () => {
    expect(read(join(SRC, "lib", "privacy", "retention-policy.ts"))).toMatch(/safeSweepAnalyticsRetention/);
  });

  it("every analytics permission is described", () => {
    const perms = read(join(SRC, "lib", "permissions.ts"));
    const defs = read(join(SRC, "lib", "permission-defs.ts"));
    const names = [...new Set([...perms.matchAll(/"(analytics:[a-z_:]+)"/g)].map((m) => m[1]))];
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const n of names) expect(defs, n).toContain(`"${n}"`);
  });
});
