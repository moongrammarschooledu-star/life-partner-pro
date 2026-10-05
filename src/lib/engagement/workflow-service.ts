import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { engagementAudit } from "@/lib/engagement/audit";
import { assertApprovedPayloadMatches, gateEngagementAction } from "@/lib/engagement/approval";
import { scanEngagementContent } from "@/lib/engagement/content-scan";
import { DEFAULT_WORKFLOWS } from "@/lib/engagement/workflow-defaults";
import { definitionHash, definitionTexts, parseDefinition, type WorkflowDefinition } from "@/lib/engagement/workflow-schema";
import { ENGAGEMENT_EVENT_TYPES } from "@/lib/engagement/constants";
import type { SessionAdmin } from "@/lib/route-guard";
import type { EngagementEventType, EngagementWorkflow, EngagementWorkflowVersion } from "@prisma/client";

// STEP 30 — workflow lifecycle. Same governance shape as the marketing landing-page versions:
//   version: DRAFT -> REVIEW -> APPROVED -> (published) ... SUPERSEDED / REJECTED
//   workflow: DRAFT -> PUBLISHED <-> PAUSED -> ARCHIVED
// A reviewer can never be the author; publishing goes through the STEP 19 gate bound to the content hash; editing a published
// workflow creates a NEW draft version and the live version keeps running until the new one is published; rollback clones
// an earlier version forward as a new draft (history is never rewritten).

const EDITABLE: Array<EngagementWorkflowVersion["status"]> = ["DRAFT", "REJECTED"];

function checkTrigger(trigger: string): EngagementEventType {
  if (!(ENGAGEMENT_EVENT_TYPES as string[]).includes(trigger)) throw new HttpError(422, "Unknown trigger event.");
  return trigger as EngagementEventType;
}

function shortText(value: string | null | undefined, max: number, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const v = value.trim();
  if (v.length > max || /[<>]/.test(v)) throw new HttpError(422, `${name} is invalid or too long.`);
  return v;
}

export async function createWorkflow(actor: SessionAdmin, input: { name: string; description?: string | null; trigger: string; definition: unknown; changeSummary?: string | null }) {
  const name = shortText(input.name, 120, "Name");
  if (!name || name.length < 3) throw new HttpError(422, "A workflow name of at least 3 characters is required.");
  const trigger = checkTrigger(input.trigger);
  const def = parseDefinition(input.definition);
  const code = await nextSequenceCode("EWF");
  const wf = await prisma.engagementWorkflow.create({
    data: {
      code, name, description: shortText(input.description, 400, "Description"), trigger, createdById: actor.id,
      versions: { create: { version: 1, status: "DRAFT", definition: def as never, contentHash: definitionHash(def, trigger), changeSummary: shortText(input.changeSummary, 300, "Change summary"), authorId: actor.id } },
    },
  });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_CREATED", actorId: actor.id, resource: "engagement_workflow", resourceId: wf.id, after: { code, trigger } });
  return wf;
}

export async function saveWorkflowDraft(actor: SessionAdmin, id: string, input: { definition: unknown; name?: string; description?: string | null; changeSummary?: string | null }): Promise<EngagementWorkflowVersion> {
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  if (wf.status === "ARCHIVED") throw new HttpError(409, "An archived workflow cannot be edited.");
  const def = parseDefinition(input.definition);
  const hash = definitionHash(def, wf.trigger);
  const latest = wf.versions[0];
  if (input.name || input.description !== undefined) {
    await prisma.engagementWorkflow.update({ where: { id }, data: { ...(input.name ? { name: shortText(input.name, 120, "Name") ?? wf.name } : {}), ...(input.description !== undefined ? { description: shortText(input.description, 400, "Description") } : {}) } });
  }
  let version: EngagementWorkflowVersion;
  if (latest && EDITABLE.includes(latest.status)) {
    version = await prisma.engagementWorkflowVersion.update({ where: { id: latest.id }, data: { definition: def as never, contentHash: hash, changeSummary: shortText(input.changeSummary, 300, "Change summary"), status: "DRAFT", policyScanResult: undefined, authorId: actor.id, reviewerId: null, reviewedAt: null } });
  } else {
    version = await prisma.engagementWorkflowVersion.create({ data: { workflowId: id, version: (latest?.version ?? 0) + 1, status: "DRAFT", definition: def as never, contentHash: hash, changeSummary: shortText(input.changeSummary, 300, "Change summary"), authorId: actor.id } });
    await prisma.engagementWorkflow.update({ where: { id }, data: { currentVersion: version.version } });
  }
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_UPDATED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, after: { version: version.version } });
  return version;
}

async function getVersion(workflowId: string, version: number) {
  const v = await prisma.engagementWorkflowVersion.findUnique({ where: { workflowId_version: { workflowId, version } } });
  if (!v) throw new HttpError(404, "Version not found.");
  return v;
}

export async function submitWorkflowVersion(actor: SessionAdmin, id: string, version: number) {
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  const v = await getVersion(id, version);
  if (!EDITABLE.includes(v.status)) throw new HttpError(409, "Only a draft can be submitted for review.");
  const def = parseDefinition(v.definition);
  const scan = scanEngagementContent({ texts: definitionTexts(def) });
  if (!scan.pass) {
    await engagementAudit({ action: "ENGAGEMENT_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, extra: { rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This workflow conflicts with the engagement content policy."), { findings: scan.findings });
  }
  const updated = await prisma.engagementWorkflowVersion.update({ where: { id: v.id }, data: { status: "REVIEW", policyScanResult: scan as never } });
  await prisma.engagementWorkflow.update({ where: { id }, data: { status: wf.status === "DRAFT" ? "REVIEW" : wf.status } });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_SUBMITTED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, after: { version } });
  return updated;
}

export async function reviewWorkflowVersion(actor: SessionAdmin, id: string, version: number, decision: "APPROVE" | "REJECT", note?: string) {
  const v = await getVersion(id, version);
  if (v.status !== "REVIEW") throw new HttpError(409, "Only a version in review can be decided.");
  if (actor.id === v.authorId) throw new HttpError(403, "You cannot review a workflow version you wrote.");
  if (decision === "REJECT" && (note ?? "").trim().length < 5) throw new HttpError(422, "A reason is required to reject.");
  if (decision === "APPROVE") {
    const scan = scanEngagementContent({ texts: definitionTexts(parseDefinition(v.definition)) });
    if (!scan.pass) throw Object.assign(new HttpError(422, "This workflow no longer passes the engagement content policy."), { findings: scan.findings });
  }
  const updated = await prisma.engagementWorkflowVersion.update({ where: { id: v.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewerId: actor.id, reviewedAt: new Date() } });
  await engagementAudit({ action: decision === "APPROVE" ? "ENGAGEMENT_WORKFLOW_APPROVED" : "ENGAGEMENT_WORKFLOW_REJECTED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, after: { version }, reason: note });
  return updated;
}

export type PublishOutcome = { approvalRequired: false; workflow: EngagementWorkflow } | { approvalRequired: true; approvalCode: string; status: string };

export async function publishWorkflowVersion(actor: SessionAdmin, id: string, version: number, reason: string): Promise<PublishOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  if (wf.status === "ARCHIVED") throw new HttpError(409, "An archived workflow cannot be published.");
  const v = await getVersion(id, version);
  if (v.status !== "APPROVED") throw new HttpError(409, "Only an approved version can be published.");
  if (!v.reviewerId || v.reviewerId === v.authorId) throw new HttpError(403, "This version has no valid independent review.");
  // the stored definition must still validate and be the exact content that was reviewed
  const def = parseDefinition(v.definition);
  if (definitionHash(def, wf.trigger) !== v.contentHash) throw new HttpError(409, "The workflow content changed after it was reviewed. Submit it again.");

  const payload = { workflowId: id, version, contentHash: v.contentHash };
  const gate = await gateEngagementAction({ actionType: "ENGAGEMENT_WORKFLOW_PUBLISH", sourceId: `workflow:${id}:v${version}`, actor, reason, requestedPayload: payload });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, payload);

  const now = new Date();
  await prisma.$transaction([
    ...(wf.publishedVersionId ? [prisma.engagementWorkflowVersion.updateMany({ where: { id: wf.publishedVersionId, status: "APPROVED" }, data: { status: "SUPERSEDED" } })] : []),
    prisma.engagementWorkflowVersion.update({ where: { id: v.id }, data: { publishedAt: now } }),
    prisma.engagementWorkflow.update({ where: { id }, data: { status: "PUBLISHED", publishedVersionId: v.id } }),
  ]);
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_PUBLISHED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, after: { version, contentHash: v.contentHash }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, workflow: (await prisma.engagementWorkflow.findUnique({ where: { id } })) as EngagementWorkflow };
}

export async function pauseWorkflow(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  if (wf.status !== "PUBLISHED") throw new HttpError(409, "Only a published workflow can be paused.");
  const updated = await prisma.engagementWorkflow.update({ where: { id }, data: { status: "PAUSED" } });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_PAUSED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, reason });
  return updated;
}

// Resuming does not need a new approval (the same reviewed version goes live again) but needs a reason and the content hash must still match.
export async function resumeWorkflow(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  if (wf.status !== "PAUSED" || !wf.publishedVersionId) throw new HttpError(409, "Only a paused workflow can be resumed.");
  const v = await prisma.engagementWorkflowVersion.findUnique({ where: { id: wf.publishedVersionId } });
  if (!v || definitionHash(parseDefinition(v.definition), wf.trigger) !== v.contentHash) throw new HttpError(409, "The published version no longer matches what was approved.");
  const updated = await prisma.engagementWorkflow.update({ where: { id }, data: { status: "PUBLISHED" } });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_RESUMED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, reason });
  return updated;
}

export async function archiveWorkflow(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  const updated = await prisma.engagementWorkflow.update({ where: { id }, data: { status: "ARCHIVED" } });
  await prisma.engagementWorkflowRun.updateMany({ where: { workflowId: id, status: "ACTIVE" }, data: { status: "CANCELLED", lastNote: "WORKFLOW_ARCHIVED", completedAt: new Date(), nextRunAt: null } });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_ARCHIVED", actorId: actor.id, resource: "engagement_workflow", resourceId: id, reason });
  return updated;
}

export async function rollbackWorkflow(actor: SessionAdmin, id: string, fromVersion: number, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  const old = await getVersion(id, fromVersion);
  if (!["APPROVED", "SUPERSEDED"].includes(old.status)) throw new HttpError(409, "Only a previously approved version can be rolled back to.");
  const def: WorkflowDefinition = parseDefinition(old.definition); // re-validated against the CURRENT vocabulary
  const next = (wf.versions[0]?.version ?? 0) + 1;
  const created = await prisma.engagementWorkflowVersion.create({ data: { workflowId: id, version: next, status: "DRAFT", definition: def as never, contentHash: definitionHash(def, wf.trigger), changeSummary: `Rolled back to version ${fromVersion}`, clonedFromVersionId: old.id, authorId: actor.id } });
  await prisma.engagementWorkflow.update({ where: { id }, data: { currentVersion: next } });
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_ROLLED_BACK", actorId: actor.id, resource: "engagement_workflow", resourceId: id, after: { newVersion: next, fromVersion }, reason });
  return created;
}

// Installs the specification's lifecycle automations as drafts. Existing workflows (same name) are left alone.
export async function installDefaultWorkflows(actor: SessionAdmin): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const d of DEFAULT_WORKFLOWS) {
    const exists = await prisma.engagementWorkflow.findFirst({ where: { name: d.name }, select: { id: true } });
    if (exists) {
      skipped++;
      continue;
    }
    await createWorkflow(actor, { name: d.name, description: d.description, trigger: d.trigger, definition: d.definition, changeSummary: "Installed default" });
    created++;
  }
  return { created, skipped };
}

export async function listWorkflows(take = 100) {
  return prisma.engagementWorkflow.findMany({
    orderBy: { createdAt: "desc" }, take: Math.min(take, 200),
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, status: true } }, _count: { select: { runs: true } } },
  });
}

export async function getWorkflowDetail(id: string) {
  const wf = await prisma.engagementWorkflow.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 30 } } });
  if (!wf) throw new HttpError(404, "Workflow not found.");
  const runStats = await prisma.engagementWorkflowRun.groupBy({ by: ["status"], where: { workflowId: id }, _count: { status: true } });
  return { workflow: wf, runStats: runStats.map((r) => ({ status: r.status, count: r._count.status })) };
}
