// Pure rollback-compatibility check (spec §26). Prisma migrations are
// forward-only, so rolling application code back to an older release is only
// blindly safe when NO migration was applied after that release. Anything
// newer needs a human decision (expand/contract compatibility review).

export type RollbackVerdict = "SAFE" | "REQUIRES_REVIEW" | "UNKNOWN";

export interface RollbackAssessment {
  verdict: RollbackVerdict;
  newerMigrations: string[];
  message: string;
}

export function assessRollback(params: { currentMigrations: string[] | null; targetMigrations: string[] | null }): RollbackAssessment {
  const { currentMigrations, targetMigrations } = params;
  if (!currentMigrations || !targetMigrations) {
    return { verdict: "UNKNOWN", newerMigrations: [], message: "Migration history is not recorded for one of the releases; a manual compatibility review is required." };
  }
  const target = new Set(targetMigrations);
  const newer = currentMigrations.filter((m) => !target.has(m));
  if (newer.length === 0) {
    return { verdict: "SAFE", newerMigrations: [], message: "No migrations were applied after the rollback target; application rollback does not depend on schema changes." };
  }
  return {
    verdict: "REQUIRES_REVIEW",
    newerMigrations: newer,
    message: `${newer.length} migration(s) were applied after the rollback target and cannot be reversed automatically. Confirm the older code is compatible with the newer schema before rolling back (or restore from a verified backup).`,
  };
}
