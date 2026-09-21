import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import type { Permission } from "@/lib/permissions";
import { typePermissionFor } from "@/lib/case-type-permission";
import { resolveDateRange } from "@/lib/reports/date-range";
import { computeProposalAnalytics } from "@/lib/reports/aggregate/proposals";
import { computeFollowUpAnalytics } from "@/lib/reports/aggregate/followups";
import { computeCasesReport } from "@/lib/reports/aggregate/cases";
import { computeRegistrationAnalytics } from "@/lib/reports/aggregate/registration";
import { computeVerificationAnalytics } from "@/lib/reports/aggregate/verification";
import type { Evidence, AiLanguage, CommunicationKind } from "@/lib/ai/types";
import { COMMUNICATION_KINDS, LANGUAGES } from "@/lib/ai/types";
import { loadAuthorizedProfile } from "@/lib/ai/load";
import { loadConsentDecision } from "@/lib/ai/consent";
import { loadMatchConfig } from "@/lib/ai/match-config";
import { analyzeMutual } from "@/lib/ai/analysis/mutual";
import { buildProfileSummary } from "@/lib/ai/analysis/summary";
import { buildMatchExplanation } from "@/lib/ai/analysis/match-review";
import { buildCommunicationDraft } from "@/lib/ai/analysis/drafts";
import { restrictedCategoriesFor } from "@/lib/ai/load";
import { validateFilter, filterToWhere } from "@/lib/ai/copilot/nl-filter";
import type { ToolName } from "@/lib/ai/copilot/intent";

// Spec §32/§33 — the Copilot's tool registry. The router (or, in future, a
// model) can only REQUEST a tool by name + arguments. Here every request is
// re-validated (strict Zod schema) and re-authorised against the requesting
// admin's OWN permissions, assignment scope and the member's consent — the AI
// never decides its own permissions. All tools are READ or DRAFT; there is no
// tool that sends, approves, shares, deletes, suspends, refunds or finalises.

export interface ToolOutput {
  heading: string;
  lines: Evidence[];
  missing?: string[];
  conflicts?: string[];
  questions?: string[];
  next?: string | null;
  data?: Record<string, unknown>;
}

interface ToolDef<S extends z.ZodTypeAny> {
  permissions: Permission[]; // ALL required, checked independently of the AI feature permission
  schema: S;
  execute: (admin: SessionAdmin, args: z.infer<S>) => Promise<ToolOutput>;
}

const db = (label: string, value: string | number): Evidence => ({ label, value: String(value).slice(0, 300), source: "DATABASE" });
const code = z.string().trim().regex(/^LPP-[A-Z0-9-]{3,20}$/i).transform((s) => s.toUpperCase());

async function resolveProfileId(profileCode: string): Promise<string> {
  const p = await prisma.profile.findFirst({ where: { profileCode, softDeleted: false }, select: { id: true } });
  // Unknown and inaccessible look identical — no existence oracle.
  if (!p) throw new ApiError(403, "You do not have access to this profile.");
  return p.id;
}

async function assertInternalConsent(profileIds: string[]): Promise<void> {
  const d = await loadConsentDecision("COPILOT", profileIds);
  if (!d.internalOk) throw new ApiError(403, "AI-assisted processing is not available for this profile.");
}

async function assignedProfileIds(admin: SessionAdmin): Promise<string[] | null> {
  if (admin.role !== "STAFF") return null;
  const rows = await prisma.adminAssignment.findMany({ where: { resourceType: "PROFILE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
  return rows.map((r) => r.resourceId);
}

function tool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const TOOLS = {
  searchProfiles: tool({
    permissions: ["profile:view"],
    schema: z.object({ filter: z.unknown() }).strict(),
    async execute(admin, args) {
      let filter: ReturnType<typeof validateFilter>;
      try {
        filter = validateFilter(args.filter); // rejects any unknown field / operator / bad value
      } catch {
        throw new ApiError(400, "The search could not be understood safely.");
      }
      const assigned = await assignedProfileIds(admin);
      const rows = await prisma.profile.findMany({
        where: filterToWhere(filter, { assignedIds: assigned }),
        take: filter.limit,
        orderBy: { createdAt: "desc" },
        select: { profileCode: true, gender: true, city: true, country: true, maritalStatus: true, profileCompletion: true, education: { select: { level: true } }, profession: { select: { profession: true } }, verification: { select: { status: true } } },
      });
      return {
        heading: `Found ${rows.length} profile(s) matching the validated filter.`,
        lines: rows.map((r) => db(r.profileCode, [r.gender, r.city, r.education?.level, r.profession?.profession, r.verification?.status ?? "NOT_VERIFIED"].filter(Boolean).join(" · "))),
        next: rows.length ? "Open a profile and ask for a summary or a match explanation." : "Try widening the filter.",
        data: { filter, count: rows.length },
      };
    },
  }),

  getProfileSummary: tool({
    permissions: ["ai:use"],
    schema: z.object({ profileCode: code }).strict(),
    async execute(admin, args) {
      const id = await resolveProfileId(args.profileCode);
      const { view } = await loadAuthorizedProfile(admin, id);
      await assertInternalConsent([id]);
      const s = buildProfileSummary(view);
      return { heading: s.summary, lines: s.evidence.slice(0, 20), missing: s.missingInformation, conflicts: s.potentialConflicts, questions: s.verificationQuestions, next: s.suggestedNextStep, data: { sufficiency: s.sufficiency } };
    },
  }),

  explainMatch: tool({
    permissions: ["ai:use", "match:run"],
    schema: z.object({ profileACode: code, profileBCode: code }).strict(),
    async execute(admin, args) {
      const [aId, bId] = [await resolveProfileId(args.profileACode), await resolveProfileId(args.profileBCode)];
      if (aId === bId) throw new ApiError(400, "Select two different profiles.");
      const a = await loadAuthorizedProfile(admin, aId, 0, { matching: true });
      const b = await loadAuthorizedProfile(admin, bId, 1, { matching: true });
      await assertInternalConsent([aId, bId]);
      const m = analyzeMutual(a, b, { config: await loadMatchConfig(), restrictedCategories: restrictedCategoriesFor(admin) });
      const e = buildMatchExplanation(a.view, b.view, m);
      return { heading: e.summary, lines: e.evidence.slice(0, 20), missing: e.missingInformation, conflicts: e.potentialConflicts, questions: e.verificationQuestions, next: e.suggestedNextStep, data: { sufficiency: e.sufficiency } };
    },
  }),

  getProposalStatus: tool({
    permissions: ["proposal:create"],
    schema: z.object({}).strict(),
    async execute(admin) {
      const where = admin.role === "STAFF" ? { assignedToId: admin.id } : {};
      const groups = await prisma.proposal.groupBy({ by: ["status"], where, _count: { _all: true } });
      const total = groups.reduce((n, g) => n + g._count._all, 0);
      return {
        heading: `${total} proposal(s)${admin.role === "STAFF" ? " assigned to you" : ""}.`,
        lines: groups.map((g) => db(`Proposals — ${g.status.replace(/_/g, " ").toLowerCase()}`, g._count._all)),
        next: total ? "Open Proposals to review those needing action." : null,
      };
    },
  }),

  getFollowUps: tool({
    permissions: ["profile:view"],
    schema: z.object({ scope: z.enum(["PENDING", "OVERDUE"]).default("PENDING") }).strict(),
    async execute(admin, args) {
      const now = new Date();
      const where = { status: "PENDING" as const, ...(args.scope === "OVERDUE" ? { dueDate: { lt: now } } : {}), ...(admin.role === "STAFF" ? { adminId: admin.id } : {}) };
      const [count, rows] = await Promise.all([
        prisma.followUp.count({ where }),
        prisma.followUp.findMany({ where, take: 10, orderBy: { dueDate: "asc" }, select: { purpose: true, priority: true, dueDate: true, profile: { select: { profileCode: true } } } }),
      ]);
      return {
        heading: `${count} ${args.scope === "OVERDUE" ? "overdue" : "pending"} follow-up(s)${admin.role === "STAFF" ? " assigned to you" : ""}.`,
        lines: rows.map((r) => db(r.profile.profileCode, `${r.priority} · due ${r.dueDate.toISOString().slice(0, 10)}${r.purpose ? ` · ${r.purpose.slice(0, 80)}` : ""}`)),
        next: count ? "Ask me to draft a gentle reminder for one of these profiles." : null,
      };
    },
  }),

  getSupportCases: tool({
    permissions: ["cases:view"],
    schema: z.object({}).strict(),
    async execute(admin) {
      const allTypes = ["SUPPORT", "COMPLAINT", "SAFETY_REPORT", "INTERNAL", "PRIVACY_INCIDENT", "SYSTEM_INCIDENT"] as const;
      // A type with its own permission needs that permission; a type with none
      // (INTERNAL, SYSTEM_INCIDENT) is only summarised for SUPER_ADMIN / ADMIN.
      const allowed = allTypes.filter((t) => {
        const p = typePermissionFor(t, "view");
        return p ? admin.permissions.includes(p) : admin.role === "SUPER_ADMIN" || admin.role === "ADMIN";
      });
      let caseIdFilter: { id: { in: string[] } } | Record<string, never> = {};
      if (admin.role === "STAFF") {
        const rows = await prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
        caseIdFilter = { id: { in: rows.map((r) => r.resourceId) } };
      }
      const groups = await prisma.case.groupBy({ by: ["status"], where: { type: { in: allowed }, status: { notIn: ["CLOSED", "ARCHIVED", "RESOLVED"] }, OR: [{ reportedAdminId: null }, { reportedAdminId: { not: admin.id } }], ...caseIdFilter }, _count: { _all: true } });
      const total = groups.reduce((n, g) => n + g._count._all, 0);
      return {
        heading: `${total} unresolved case(s) you are permitted to see.`,
        lines: groups.map((g) => db(`Cases — ${g.status.replace(/_/g, " ").toLowerCase()}`, g._count._all)),
        next: total ? "Open Case Management for details." : null,
      };
    },
  }),

  draftMessage: tool({
    permissions: ["ai:communication:draft"],
    schema: z.object({ profileCode: code, kind: z.enum(COMMUNICATION_KINDS).default("PROPOSAL_MESSAGE"), language: z.enum(LANGUAGES).default("en") }).strict(),
    async execute(admin, args) {
      const id = await resolveProfileId(args.profileCode);
      const { view } = await loadAuthorizedProfile(admin, id);
      await assertInternalConsent([id]);
      const d = buildCommunicationDraft({ kind: args.kind as CommunicationKind, language: args.language as AiLanguage, recipientCode: view.profileCode });
      return { heading: d.summary, lines: [], questions: d.verificationQuestions, next: d.suggestedNextStep, data: d.data };
    },
  }),

  getReportSummary: tool({
    permissions: ["reports:view", "ai:report:use"],
    schema: z.object({ report: z.enum(["registrations", "proposals", "followups", "verification", "support"]), days: z.number().int().min(1).max(365).default(30) }).strict(),
    async execute(_admin, args) {
      const to = new Date();
      const from = new Date(to.getTime() - args.days * 86_400_000);
      const dateRange = resolveDateRange("custom", from.toISOString(), to.toISOString());
      const filters = { dateRange };
      const figures: Array<[string, number]> = [];
      if (args.report === "registrations") figures.push(["New registrations", (await computeRegistrationAnalytics(filters)).totalInRange]);
      if (args.report === "proposals") {
        const r = await computeProposalAnalytics(filters);
        figures.push(["Proposals created", r.total], ...Object.entries(r.byStatus).map(([k, v]) => [`Proposals — ${k}`, v as number] as [string, number]));
      }
      if (args.report === "followups") {
        const r = await computeFollowUpAnalytics(filters);
        figures.push(["Follow-ups due today", r.today], ["Follow-ups completed", r.completed], ["Follow-ups pending", r.pending], ["Follow-ups overdue", r.overdue]);
      }
      if (args.report === "verification") {
        const r = await computeVerificationAnalytics(filters);
        figures.push(["Verification pending", r.counts.pending], ["Under review", r.counts.underReview], ["Verified", r.counts.verified], ["Rejected", r.counts.rejected]);
      }
      if (args.report === "support") {
        const r = await computeCasesReport(filters);
        figures.push(["Cases in range", r.totalCases], ["Open cases", r.openCases], ["Closed cases", r.closedCases], ["Escalated", r.escalatedCases], ["SLA overdue", r.slaOverdueCount]);
      }
      return {
        heading: `${args.report} — last ${args.days} days (figures from the Life Partner Pro database).`,
        lines: figures.map(([l, v]) => db(l, v)),
        data: { source: "Life Partner Pro database", generatedAt: to.toISOString(), figures: Object.fromEntries(figures) },
      };
    },
  }),
};

const _registryComplete: Record<ToolName, unknown> = TOOLS; // compile-time check: every ToolName has a tool
void _registryComplete;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export async function executeTool(name: string, rawArgs: unknown, admin: SessionAdmin): Promise<ToolOutput> {
  // hasOwn: a request for "constructor" / "__proto__" / "toString" must not resolve to anything.
  if (!Object.hasOwn(TOOLS, name)) throw new ApiError(400, "Unknown tool.");
  const def = TOOLS[name as ToolName] as ToolDef<z.ZodTypeAny>;
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) throw new ApiError(400, "The request could not be understood safely.");
  for (const p of def.permissions) {
    if (!admin.permissions.includes(p)) throw new ApiError(403, "You do not have permission for this action.");
  }
  return def.execute(admin, parsed.data);
}
