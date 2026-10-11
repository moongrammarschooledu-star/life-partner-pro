import type { BackupHealth } from "@/lib/soc/backups";

// STEP 32 — the readiness verdict. COMPUTED from the facts below on every request, never hard-coded and never edited by hand:
//   NOT_READY            — at least one check FAILED (something is broken or an unhandled critical finding is open);
//   READY_WITH_WARNINGS  — nothing failed, but at least one check could not be shown to be in good order;
//   PRODUCTION_READY     — every check passed.
// A check can only PASS on evidence. "No data" is a warning (we cannot say it is fine), never a pass.

export type ReadinessState = "NOT_READY" | "READY_WITH_WARNINGS" | "PRODUCTION_READY";
export type CheckStatus = "PASS" | "WARN" | "FAIL";
export interface ReadinessCheck { key: string; label: string; status: CheckStatus; detail: string }

export interface ReadinessInputs {
  now: Date;
  flags: { socEnabled: boolean; detection: boolean; escalation: boolean };
  lastDetectionAt: Date | null;
  lastDetectionErrors: number;
  backup: { health: BackupHealth; reasons: string[] };
  restore: { hasProof: boolean; ageDays: number | null; staleAfterDays: number };
  dr: { hasActivePlan: boolean; rpo: "MET" | "EXCEEDED" | "NOT_MEASURED"; rto: "MET" | "EXCEEDED" | "NOT_MEASURED"; testOverdue: boolean };
  openCriticalAlerts: number;
  openHighAlerts: number;
  openCriticalIncidents: number;
  mfaGaps: number;
  privilegedAdmins: number;
  sessionIdleMinutes: number | null;
  cspEnforced: boolean;
  backupCiphertextPublicUrls: boolean; // true while backup objects are written with public (unguessable) URLs
}

export function computeReadiness(i: ReadinessInputs): { state: ReadinessState; checks: ReadinessCheck[]; counts: Record<CheckStatus, number> } {
  const checks: ReadinessCheck[] = [];
  const add = (key: string, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });
  const hours = (d: Date | null) => (d ? (i.now.getTime() - d.getTime()) / 3_600_000 : null);

  // detection
  if (!i.flags.socEnabled || !i.flags.detection) add("DETECTION_RUNNING", "Threat detection is running", "WARN", "Threat detection is switched off, so nothing is watching for suspicious activity.");
  else if (i.lastDetectionAt === null) add("DETECTION_RUNNING", "Threat detection is running", "WARN", "Detection is on but has not run yet.");
  else if (i.lastDetectionErrors > 0) add("DETECTION_RUNNING", "Threat detection is running", "FAIL", `The last detection run had ${i.lastDetectionErrors} error(s).`);
  else if ((hours(i.lastDetectionAt) ?? 0) > 36) add("DETECTION_RUNNING", "Threat detection is running", "WARN", "The last detection run was more than 36 hours ago.");
  else add("DETECTION_RUNNING", "Threat detection is running", "PASS", "Detection ran within the last 36 hours without errors.");

  add("ESCALATION_ON", "Unacknowledged alerts are escalated", i.flags.escalation ? "PASS" : "WARN", i.flags.escalation ? "Escalation is switched on." : "Escalation is switched off: an alert nobody acknowledges will not be pushed to anyone.");

  // findings
  if (i.openCriticalAlerts > 0 || i.openCriticalIncidents > 0) add("OPEN_CRITICAL", "No open critical findings", "FAIL", `${i.openCriticalAlerts} critical alert(s) and ${i.openCriticalIncidents} critical incident(s) are still open.`);
  else if (i.openHighAlerts > 0) add("OPEN_CRITICAL", "No open critical findings", "WARN", `${i.openHighAlerts} high-severity alert(s) are still open.`);
  else add("OPEN_CRITICAL", "No open critical findings", "PASS", "No critical or high-severity alert or incident is open.");

  // backups & recovery
  const b = i.backup.health;
  add("BACKUP_HEALTHY", "Backups are current and verified", b === "HEALTHY" ? "PASS" : b === "WARNING" || b === "DISABLED" ? "WARN" : "FAIL", b === "HEALTHY" ? "The latest backup completed, passed verification and is within the limit." : i.backup.reasons.join(" ") || `Backup status: ${b}.`);
  if (!i.restore.hasProof) add("RESTORE_PROVEN", "A restore has been proven", "WARN", "No restore drill has been completed and approved. A verified backup is not proof that a restore works.");
  else if ((i.restore.ageDays ?? 0) > i.restore.staleAfterDays) add("RESTORE_PROVEN", "A restore has been proven", "WARN", `The last approved restore drill is ${i.restore.ageDays} days old (limit ${i.restore.staleAfterDays}).`);
  else add("RESTORE_PROVEN", "A restore has been proven", "PASS", `An independently reviewed restore drill passed ${i.restore.ageDays} day(s) ago.`);
  add("BACKUP_STORAGE_PRIVATE", "Stored files are not publicly addressable", i.backupCiphertextPublicUrls ? "WARN" : "PASS", i.backupCiphertextPublicUrls ? "Backups, photos, documents and evidence are encrypted before upload and unreadable without the server-held key, but the storage service gives each file a public (unguessable) address. Move to private storage when it is available." : "Stored files are kept privately.");
  add("DR_PLAN", "A disaster-recovery plan is approved", i.dr.hasActivePlan ? "PASS" : "WARN", i.dr.hasActivePlan ? "An approved plan is in force." : "No approved disaster-recovery plan exists.");
  add("RPO", "Recovery point objective is met", i.dr.rpo === "MET" ? "PASS" : i.dr.rpo === "EXCEEDED" ? "FAIL" : "WARN", i.dr.rpo === "MET" ? "The newest verified backup is within the configured RPO." : i.dr.rpo === "EXCEEDED" ? "The newest verified backup is older than the configured RPO." : "Not measured yet (no verified backup).");
  add("RTO", "Recovery time objective is met", i.dr.rto === "MET" ? "PASS" : i.dr.rto === "EXCEEDED" ? "FAIL" : "WARN", i.dr.rto === "MET" ? "The latest approved restore drill finished within the configured RTO." : i.dr.rto === "EXCEEDED" ? "The latest approved restore drill took longer than the configured RTO." : "Not measured yet (no approved restore drill).");
  add("DR_TESTS", "Recovery tests are on schedule", i.dr.testOverdue ? "WARN" : "PASS", i.dr.testOverdue ? "A recovery test is overdue against the plan's schedule." : "Recovery tests are on schedule (or no schedule is set).");

  // administrator security
  add("MFA_COVERAGE", "Privileged administrators have a second step", i.mfaGaps === 0 ? "PASS" : "WARN", i.mfaGaps === 0 ? `All ${i.privilegedAdmins} privileged administrator(s) are covered.` : `${i.mfaGaps} of ${i.privilegedAdmins} privileged administrator(s) sign in without a second step.`);
  add("SESSION_POLICY", "Idle administrator sessions end", i.sessionIdleMinutes ? "PASS" : "WARN", i.sessionIdleMinutes ? `Sessions end after ${i.sessionIdleMinutes} minutes without use.` : "No idle timeout is configured.");

  // transport
  add("CSP_ENFORCED", "Content-Security-Policy is enforced", i.cspEnforced ? "PASS" : "WARN", i.cspEnforced ? "The policy is enforced." : "The policy is in report-only mode: violations are reported but not blocked.");

  const counts = { PASS: 0, WARN: 0, FAIL: 0 } as Record<CheckStatus, number>;
  for (const c of checks) counts[c.status]++;
  return { state: counts.FAIL > 0 ? "NOT_READY" : counts.WARN > 0 ? "READY_WITH_WARNINGS" : "PRODUCTION_READY", checks, counts };
}
