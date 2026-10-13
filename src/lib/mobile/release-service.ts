import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";
import { recordConfigChange } from "@/lib/platform/config-change";
import { isValidVersion } from "@/lib/mobile/version";

// Release records (STEP 37 §44). A record of what was released where and when; the store console remains the place a release really happens. Moving a
// release to PRODUCTION goes through the approval gate (action MOBILE_PRODUCTION_RELEASE), so a second person agrees before the log says "production".

export const RELEASE_STATUSES = ["DRAFT", "INTERNAL_TESTING", "CLOSED_TESTING", "OPEN_TESTING", "PRODUCTION", "PAUSED", "RETIRED"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

const TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  DRAFT: ["INTERNAL_TESTING", "RETIRED"],
  INTERNAL_TESTING: ["CLOSED_TESTING", "OPEN_TESTING", "PRODUCTION", "PAUSED", "RETIRED"],
  CLOSED_TESTING: ["OPEN_TESTING", "PRODUCTION", "PAUSED", "RETIRED"],
  OPEN_TESTING: ["PRODUCTION", "PAUSED", "RETIRED"],
  PRODUCTION: ["PAUSED", "RETIRED"],
  PAUSED: ["PRODUCTION", "RETIRED"],
  RETIRED: [],
};

export function canMove(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function need(admin: SessionAdmin) {
  if (!admin.permissions.includes("platform:mobile:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
}

export async function listReleases(limit = 50) {
  return prisma.mobileRelease.findMany({ orderBy: [{ createdAt: "desc" }], take: Math.min(100, limit) });
}

export async function createRelease(admin: SessionAdmin, input: { platform: unknown; version: unknown; buildNumber: unknown; releaseNotes: unknown; environment: unknown; reason: unknown }) {
  need(admin);
  if (input.platform !== "ANDROID" && input.platform !== "IOS") throw new ApiError(400, "Unknown platform.");
  if (!isValidVersion(input.version)) throw new ApiError(400, "The version must be a dotted number such as 1.2.0.");
  if (typeof input.buildNumber !== "number" || !Number.isInteger(input.buildNumber) || input.buildNumber < 1 || input.buildNumber > 2_100_000_000) throw new ApiError(400, "The build number must be a whole number of 1 or more.");
  const notes = typeof input.releaseNotes === "string" ? input.releaseNotes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim() : "";
  if (notes.length < 3 || notes.length > 2000) throw new ApiError(400, "Release notes must be between 3 and 2000 characters.");
  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, what: { kind: "MOBILE_RELEASE", key: `${input.platform}:${input.version}` } });
  if (await prisma.mobileRelease.findFirst({ where: { platform: input.platform, version: input.version, buildNumber: input.buildNumber } })) throw new ApiError(409, "That build already has a record.");
  const row = await prisma.mobileRelease.create({ data: { platform: input.platform, version: input.version, buildNumber: input.buildNumber, releaseNotes: notes, environment: ctx.environment, createdById: admin.id } });
  await recordConfigChange({ kind: "MOBILE_RELEASE", key: row.id, before: null, after: { platform: row.platform, version: row.version, build: row.buildNumber, status: "DRAFT" }, actor: admin, reason: ctx.reason, environment: ctx.environment });
  await writeAudit({ action: "MOBILE_RELEASE_CHANGED", adminId: admin.id, meta: { id: row.id, change: "CREATED", platform: row.platform, version: row.version, build: row.buildNumber } });
  return row;
}

export async function moveRelease(admin: SessionAdmin, id: string, input: { status: unknown; rollbackReferenceId?: unknown; reason: unknown; environment: unknown }) {
  need(admin);
  if (typeof input.status !== "string" || !(RELEASE_STATUSES as readonly string[]).includes(input.status)) throw new ApiError(400, "Unknown release status.");
  const to = input.status as ReleaseStatus;
  const row = await prisma.mobileRelease.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Not found.");
  if (!canMove(row.status as ReleaseStatus, to)) throw new ApiError(409, `A release that is ${row.status.toLowerCase().replace(/_/g, " ")} cannot move to ${to.toLowerCase().replace(/_/g, " ")}.`);
  let rollbackRef: string | null = null;
  if (input.rollbackReferenceId !== undefined && input.rollbackReferenceId !== null && input.rollbackReferenceId !== "") {
    if (typeof input.rollbackReferenceId !== "string") throw new ApiError(400, "Invalid rollback reference.");
    const ref = await prisma.mobileRelease.findUnique({ where: { id: input.rollbackReferenceId } });
    if (!ref || ref.platform !== row.platform) throw new ApiError(400, "The rollback reference must be another release of the same platform.");
    rollbackRef = ref.id;
  }
  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, restrictive: to === "PAUSED" || to === "RETIRED", what: { kind: "MOBILE_RELEASE", key: id } });

  let approvalId: string | null = null;
  if (to === "PRODUCTION") {
    const gate = await enforceApprovalGate({ actionType: "MOBILE_PRODUCTION_RELEASE", sourceType: "PLATFORM_CONFIG", sourceId: `mobile-release:${id}`, actor: admin, reason: ctx.reason, currentStatePayload: { status: row.status }, requestedPayload: { status: to, platform: row.platform, version: row.version, build: row.buildNumber } });
    if (gate.requiresApproval) {
      if (gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true as const, approvalCode: gate.approvalCode, status: gate.status };
      approvalId = gate.approvalRequestId;
    }
  }

  const claimed = await prisma.mobileRelease.updateMany({
    where: { id, status: row.status },
    data: { status: to, ...(to === "PRODUCTION" ? { releasedAt: new Date(), approvedById: approvalId ? admin.id : null } : {}), ...(rollbackRef ? { rollbackReferenceId: rollbackRef } : {}) },
  });
  if (claimed.count !== 1) throw new ApiError(409, "Someone else changed this release. Reload and try again.");
  await recordConfigChange({ kind: "MOBILE_RELEASE", key: id, before: { status: row.status }, after: { status: to }, actor: admin, reason: ctx.reason, approvalId, environment: ctx.environment });
  await writeAudit({ action: "MOBILE_RELEASE_CHANGED", adminId: admin.id, meta: { id, change: to, from: row.status, platform: row.platform, version: row.version, build: row.buildNumber } });
  if (approvalId) await markApprovalExecuted(approvalId, admin.id);
  return { approvalRequired: false as const, status: to };
}