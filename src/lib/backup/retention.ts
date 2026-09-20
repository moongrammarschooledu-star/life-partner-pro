import type { BackupRetentionClass } from "@prisma/client";

// Pure grandfather-father-son retention (spec §7). Counts are configurable in
// SystemControl — no legal retention period is hard-coded here.

export function retentionClassFor(date: Date): BackupRetentionClass {
  if (date.getUTCDate() === 1) return "MONTHLY";
  if (date.getUTCDay() === 0) return "WEEKLY"; // Sunday
  return "DAILY";
}

export interface RetentionCandidate {
  id: string;
  startedAt: Date;
  retentionClass: BackupRetentionClass;
  verified: boolean;
}

export interface RetentionPolicy {
  dailyKeep: number;
  weeklyKeep: number;
  monthlyKeep: number;
}

// Returns the ids to prune: within each class only the newest N are kept.
// Safety rules: the newest backup overall and the newest VERIFIED backup are
// never pruned, whatever the policy says.
export function selectBackupsToPrune(backups: RetentionCandidate[], policy: RetentionPolicy): string[] {
  const sorted = [...backups].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const protectedIds = new Set<string>();
  if (sorted[0]) protectedIds.add(sorted[0].id);
  const newestVerified = sorted.find((b) => b.verified);
  if (newestVerified) protectedIds.add(newestVerified.id);

  const keepCount: Record<BackupRetentionClass, number> = { DAILY: policy.dailyKeep, WEEKLY: policy.weeklyKeep, MONTHLY: policy.monthlyKeep };
  const seen: Record<BackupRetentionClass, number> = { DAILY: 0, WEEKLY: 0, MONTHLY: 0 };
  const prune: string[] = [];
  for (const b of sorted) {
    seen[b.retentionClass]++;
    if (seen[b.retentionClass] > Math.max(0, keepCount[b.retentionClass]) && !protectedIds.has(b.id)) prune.push(b.id);
  }
  return prune;
}
