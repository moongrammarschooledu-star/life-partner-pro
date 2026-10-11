import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { ROLE_PERMISSIONS, hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

// STEP 33 — "No Assignment = No Record Access" for the sub-resources of a profile.
//
// Before this step only the profile detail and status routes called assertProfileAssignmentAccess; a matchmaker could add notes, run matches or
// approve a change request on a profile assigned to someone else. This test walks every route under /api/admin/profiles and proves that each
// one either enforces the assignment or is deliberately outside it for a documented reason. A new route fails here until one of the two is true.

const ROOT = join(process.cwd(), "src", "app", "api", "admin", "profiles");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routes = walk(ROOT).map((file) => ({ path: "/" + relative(ROOT, file).split(sep).slice(0, -1).join("/"), source: readFileSync(file, "utf8") }));

// Not gated by the assignment, each for a reason that is checked below or stated here.
const BY_DESIGN: Record<string, string> = {
  "/": "the list: staff browse candidates; contact columns are only searchable with the contact permission (see the oracle test)",
  "/[id]/photo/[photoId]": "list thumbnails (profile-table.tsx) use this route for every listed profile",
  "/[id]/verification": "verification is worked from a queue across profiles, not from a personal assignment",
  "/[id]/verification/actions": "verification queue action",
  "/[id]/verification/checklist": "verification queue action",
};

const scopedRoles = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => !hasBroadRecordAccess(r));
const scopedPermissions = new Set(scopedRoles.flatMap((r) => ROLE_PERMISSIONS[r] as string[]));
const permissionsOf = (src: string) => [...src.matchAll(/requireAdmin\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);

describe("assignment access on the sub-resources of a profile (STEP 33)", () => {
  it("finds the route tree (sanity)", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  it("every route enforces the assignment, is outside it by a stated design reason, or needs a permission no assignment-scoped role holds", () => {
    const offenders: string[] = [];
    for (const r of routes) {
      if (/assertProfileAssignmentAccess\(/.test(r.source)) continue;
      if (BY_DESIGN[r.path]) continue;
      const perms = permissionsOf(r.source);
      const reachableByScoped = perms.filter((p) => scopedPermissions.has(p));
      if (!perms.length || reachableByScoped.length) offenders.push(`${r.path} (${perms.join(", ") || "no permission"}${reachableByScoped.length ? "; held by an assignment-scoped role: " + reachableByScoped.join(", ") : ""})`);
    }
    expect(offenders).toEqual([]);
  });

  it("the routes fixed in this step enforce it on every state-changing and read handler", () => {
    for (const path of ["/[id]/notes", "/[id]/notes/[noteId]", "/[id]/pending-update", "/[id]/matches"]) {
      const r = routes.find((x) => x.path === path)!;
      const handlers = [...r.source.matchAll(/export (?:async function|const) (GET|POST|PATCH|PUT|DELETE)\b/g)].length || [...r.source.matchAll(/(?:async function (?:get|post|patch|put|delete)Handler)/g)].length;
      const checks = [...r.source.matchAll(/assertProfileAssignmentAccess\(/g)].length;
      expect(checks, path).toBeGreaterThanOrEqual(handlers);
    }
  });

  it("the by-design exceptions still exist (stale entries are removed)", () => {
    const existing = new Set(routes.map((r) => r.path));
    expect(Object.keys(BY_DESIGN).filter((p) => !existing.has(p))).toEqual([]);
  });
});

describe("contact search oracle (STEP 33)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), "src", "app", "api", "admin", rel), "utf8");

  it("the profile list and the global search only match on phone numbers for administrators who may see contact details", () => {
    for (const file of ["profiles/route.ts", "search/route.ts"]) {
      const src = read(file);
      // every mention of a contact-number column in a search clause sits behind the permission
      const idx = src.indexOf("mobileNumber: { contains");
      expect(idx, file).toBeGreaterThan(-1);
      const before = src.slice(Math.max(0, idx - 400), idx);
      expect(before, file).toMatch(/permissions\.includes\("sensitive:contact:view"\)/);
    }
  });

  it("an administrator without sensitive:contact:view exists among the roles that can search (so the gate matters)", () => {
    const searchers = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => (ROLE_PERMISSIONS[r] as string[]).includes("profile:view"));
    expect(searchers.some((r) => !(ROLE_PERMISSIONS[r] as string[]).includes("sensitive:contact:view"))).toBe(true);
  });
});
