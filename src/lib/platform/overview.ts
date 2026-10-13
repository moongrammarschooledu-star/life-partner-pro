import type { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionAdmin } from "@/lib/route-guard";
import { getDeploymentInfo } from "@/lib/ops/deployment-info";
import { getHealthReport } from "@/lib/ops/health";
import { getPublicState } from "@/lib/ops/system-control";
import { socOverview } from "@/lib/soc/overview";
import { currentEnvironment } from "@/lib/platform/environment-core";
import { getMaintenanceView } from "@/lib/platform/maintenance";
import { getActiveFreeze } from "@/lib/platform/freeze";
import { pendingBreakGlassReviews } from "@/lib/platform/break-glass";
import { fromHealthCheck } from "@/lib/platform/provider-status";

// The Control Center dashboard (STEP 36 §2). Every figure is a count or a status read from a real table at request time, with its source named; where there is
// nothing to count the answer is 0. A section is computed ONLY if the administrator holds the permission that section needs (the server decides, not the screen),
// and a failure to read one figure shows as "unavailable" for that figure instead of breaking the page.

export type SectionKey = "platform" | "security" | "operations" | "business" | "infrastructure" | "deployment";

export const SECTION_PERMISSION: Record<SectionKey, string> = {
  platform: "platform:control_center:view",
  security: "soc:view",
  operations: "platform:workflows:view",
  business: "analytics:view",
  infrastructure: "platform:health:view",
  deployment: "platform:deployment:view",
};

const unavailable = { unavailable: true } as const;
const isUnavailable = (v: unknown): v is typeof unavailable => typeof v === "object" && v !== null && (v as { unavailable?: unknown }).unavailable === true;
async function safe<T>(fn: () => Promise<T>): Promise<T | typeof unavailable> {
  try {
    return await fn();
  } catch {
    return unavailable;
  }
}

const OPEN_TASKS = ["NEW", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "WAITING_FOR_APPROVAL", "BLOCKED", "ESCALATED", "REOPENED"] as const;
const PENDING_APPROVALS = ["SUBMITTED", "PENDING_REVIEW", "PENDING_APPROVAL", "PARTIALLY_APPROVED"] as const;
const PENDING_VERIFICATION = ["VERIFICATION_PENDING", "UNDER_REVIEW", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED"] as const;
const PENDING_PROPOSALS = ["PROPOSAL_CREATED", "SENT", "WAITING", "WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING", "CONTACT_PERMISSION_PENDING"] as const;
const OPEN_CASES = ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_STAFF", "ESCALATED", "ACTION_REQUIRED", "REOPENED"] as const;
const OPEN_FOLLOWUPS = ["PENDING", "SCHEDULED", "IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ESCALATED", "REOPENED"] as const;
const ACTIVE_PROFILE = ["ACTIVE", "MATCHING", "PROPOSAL_SENT", "WAITING_FOR_RESPONSE", "INTERESTED", "MEETING_ARRANGED"] as const;

export async function controlCenterOverview(admin: SessionAdmin, now: Date = new Date()) {
  const can = (p: string) => admin.permissions.includes(p as never);
  const day = new Date(now.getTime() - 86_400_000);
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const out: Record<string, unknown> = { generatedAt: now.toISOString(), environment: currentEnvironment(), role: admin.role as AdminRole, sections: [] as SectionKey[] };
  const sections = out.sections as SectionKey[];

  if (can(SECTION_PERMISSION.platform)) {
    sections.push("platform");
    const [state, maintenance, freeze, sessions, reviews, deploy] = await Promise.all([
      safe(() => getPublicState()),
      safe(() => getMaintenanceView(now)),
      safe(() => getActiveFreeze(now)),
      safe(() => prisma.adminSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } })),
      safe(() => pendingBreakGlassReviews(now)),
      safe(() => getDeploymentInfo()),
    ]);
    out.platform = {
      source: "SystemControl, AdminSession, PlatformChangeFreeze, PlatformBreakGlassEvent, deployment record",
      status: "unavailable" in state ? unavailable : state.blocked ? (state.reason === "EMERGENCY" ? "DISRUPTION" : "MAINTENANCE") : state.readOnly ? "READ_ONLY" : "OPERATIONAL",
      version: "unavailable" in deploy ? unavailable : deploy.version,
      commit: "unavailable" in deploy ? unavailable : (deploy.commitSha ?? "").slice(0, 7),
      deploymentStatus: "unavailable" in deploy ? unavailable : deploy.release?.status ?? "NOT RECORDED",
      maintenance: "unavailable" in maintenance ? unavailable : { kind: maintenance.kind, active: maintenance.active },
      activeAdminSessions: sessions,
      changeFreeze: isUnavailable(freeze) ? unavailable : freeze ? { active: true, endsAt: freeze.endsAt, reason: freeze.reason } : { active: false },
      breakGlassAwaitingReview: "unavailable" in reviews ? unavailable : reviews.length,
      health: "unavailable" in deploy ? unavailable : deploy.health.overall,
    };
  }

  if (can(SECTION_PERMISSION.security)) {
    sections.push("security");
    const soc = await safe(() => socOverview(now));
    out.security = "unavailable" in soc
      ? unavailable
      : {
          source: "SocAlert, SocIncident, AdminLoginHistory, SecurityEvent, AdminSession (Security Operations)",
          openAlerts: soc.alerts.open,
          criticalAndHighAlerts: soc.criticalAndHigh.alerts,
          openIncidents: soc.incidents.open,
          failedLogins24h: Number((soc.adminLogins24h as unknown as Record<string, unknown>).failure ?? 0),
          adminSecurityEvents24h: soc.signals24h.items.filter((s) => ["ADMIN_SESSION_ANOMALY", "NEW_DEVICE_SESSION", "PERMISSION_DENIED"].includes(s.key)).reduce((n, s) => n + s.count, 0),
          suspiciousActivity24h: soc.signals24h.items.filter((s) => ["API_AUTH_FAILURE", "WEBHOOK_SIGNATURE_FAILURE", "WEBHOOK_REPLAY_ATTEMPT", "DOCUMENT_UNAUTHORIZED_ACCESS", "AI_PROMPT_INJECTION_SUSPECTED"].includes(s.key)).reduce((n, s) => n + s.count, 0),
          twoFactor: { privilegedAdmins: soc.adminSecurity.privilegedAdmins, gaps: soc.adminSecurity.mfaGaps, enforcedForPrivileged: soc.adminSecurity.enforceMfaPrivileged },
        };
  }

  if (can(SECTION_PERMISSION.operations)) {
    sections.push("operations");
    const [tasks, approvals, verification, proposals, cases, followUps] = await Promise.all([
      safe(() => prisma.adminTask.count({ where: { status: { in: [...OPEN_TASKS] } } })),
      safe(() => prisma.approvalRequest.count({ where: { status: { in: [...PENDING_APPROVALS] } } })),
      safe(() => prisma.profileVerification.count({ where: { status: { in: [...PENDING_VERIFICATION] } } })),
      safe(() => prisma.proposal.count({ where: { status: { in: [...PENDING_PROPOSALS] } } })),
      safe(() => prisma.case.count({ where: { status: { in: [...OPEN_CASES] } } })),
      safe(() => prisma.followUp.count({ where: { OR: [{ status: "OVERDUE" }, { status: { in: [...OPEN_FOLLOWUPS] }, dueDate: { lt: now } }] } })),
    ]);
    out.operations = { source: "AdminTask, ApprovalRequest, ProfileVerification, Proposal, Case, FollowUp", pendingTasks: tasks, pendingApprovals: approvals, pendingVerification: verification, pendingProposals: proposals, pendingSupportCases: cases, overdueFollowUps: followUps };
  }

  if (can(SECTION_PERMISSION.business)) {
    sections.push("business");
    const [applicants, active, matches, proposals, meetings, memberships, revenue] = await Promise.all([
      safe(() => prisma.profile.count()),
      safe(() => prisma.profile.count({ where: { status: { in: [...ACTIVE_PROFILE] } } })),
      safe(() => prisma.match.count()),
      safe(() => prisma.proposal.count()),
      safe(() => prisma.meeting.count()),
      safe(() => prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } })),
      safe(() => prisma.payment.groupBy({ by: ["currencyCode"], where: { status: "PAID", paidAt: { gte: month } }, _sum: { amountMinor: true }, _count: { _all: true } })),
    ]);
    out.business = {
      source: "Profile, Match, Proposal, Meeting, Subscription, Payment (paid, last 30 days)",
      applicants, activeProfiles: active, matches, proposals, meetings, activeMemberships: memberships,
      revenueLast30Days: "unavailable" in revenue ? unavailable : revenue.map((r) => ({ currency: r.currencyCode, amountMinor: r._sum.amountMinor ?? 0, payments: r._count._all })),
    };
  }

  if (can(SECTION_PERMISSION.infrastructure)) {
    sections.push("infrastructure");
    const report = await safe(() => getHealthReport({ detail: true }));
    out.infrastructure = "unavailable" in report
      ? unavailable
      : {
          source: "platform health checks (ops/health)",
          items: [
            ["Database", "database"], ["Storage", "storage"], ["Queue", "queue"], ["E-mail", "email"], ["Payment", "payments"], ["Authentication", "authentication"], ["Background jobs", "cron"], ["Webhooks", "webhooks"],
          ].map(([label, key]) => ({ label, status: fromHealthCheck(report.checks[key]?.status ?? "unknown"), detail: report.checks[key]?.detail ?? "" })),
          note: "SMS, WhatsApp, AI and backup status are on the Providers and Deployment pages.",
        };
  }

  if (can(SECTION_PERMISSION.deployment)) {
    sections.push("deployment");
    const deploy = await safe(() => getDeploymentInfo());
    out.deployment = "unavailable" in deploy
      ? unavailable
      : {
          source: "Release, BackupRun, RestoreTest, RestoreDrill, migrations",
          version: deploy.version, commit: (deploy.commitSha ?? "").slice(0, 7), environment: deploy.environment, deployedAt: deploy.deployedAt, migrationCount: deploy.migrationCount, lastMigration: deploy.lastMigration,
          lastBackup: deploy.backup.latest, lastVerifiedBackup: deploy.backup.latestVerified, lastRestoreTest: deploy.lastRestoreTest, lastRestoreDrill: deploy.lastRestoreDrill, health: deploy.health.overall,
        };
  }
  void day;
  return out;
}
