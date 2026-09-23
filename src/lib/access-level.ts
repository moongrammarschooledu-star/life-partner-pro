// STEP 17 §3 — the cross-cutting Access Level concept. Mirrors the Prisma
// `AccessLevel` enum. `src/lib/case-access.ts`'s own `CaseAccessLevel` type
// (VIEW/COMMENT/EDIT/MANAGE, no NONE here) uses the same value names by
// design, so its results are drop-in compatible wherever an `AccessLevel` is
// expected — no rewrite of that already-tested file was needed.
export type AccessLevel = "VIEW" | "COMMENT" | "EDIT" | "MANAGE" | "APPROVE" | "OWNER";

export const ACCESS_LEVELS: AccessLevel[] = ["VIEW", "COMMENT", "EDIT", "MANAGE", "APPROVE", "OWNER"];

const RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, MANAGE: 4, APPROVE: 5, OWNER: 6 };

// True when `granted` is at least as strong as `required` (spec §3's ordering:
// COMMENT = VIEW + comments, EDIT = VIEW + edits, MANAGE = EDIT + workflow,
// APPROVE = MANAGE + approval actions, OWNER = full operational control).
export function meetsAccessLevel(granted: AccessLevel, required: AccessLevel): boolean {
  return RANK[granted] >= RANK[required];
}

// STEP 18 — a task's own accessLevel caps whatever the underlying source
// record would otherwise grant (src/lib/workflow/access.ts): an admin never
// gets MORE access through a task than the task itself was scoped to.
export function minAccessLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return RANK[a] <= RANK[b] ? a : b;
}
