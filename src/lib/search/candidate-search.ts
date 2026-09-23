import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import type { SessionAdmin } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { getAssignedResourceIds } from "@/lib/admin-assignment";
import { profileListInclude, toCandidateCardDto, type ProfileListItem, type CandidateCardDto } from "@/lib/serializers";
import { validateFilterGroup, buildWhereFromFilterGroup, FilterValidationError, type FilterGroup } from "@/lib/search/filter-builder";
import { getFieldDef } from "@/lib/search/fields";
import { scoreMatch, type MatchResult, type MatchableProfile, type MatchCategory } from "@/lib/matching";
import { toMatchable, matchableInclude } from "@/lib/match-adapter";
import { loadMatchConfig } from "@/lib/ai/match-config";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { writeAudit } from "@/lib/audit";
import { recordSearchEvent, recordSensitiveSearchEvent } from "@/lib/search/audit";
import type { Prisma, ProfileStatus, SavedSearchVisibility, ShortlistStatus } from "@prisma/client";

// STEP 20 §35 — CandidateSearchService, implemented as plain exported
// functions (matching src/lib/workflow/engine.ts's and
// src/lib/approvals/engine.ts's own convention, not a class). This is the
// ONLY place that builds a Prisma.ProfileWhereInput for candidate discovery;
// /api/admin/search and /api/admin/profiles are untouched (plan decision 1).

// Extends the dependency-free HttpError (not route-guard.ts's ApiError
// directly — same reasoning as WorkflowError/ApprovalError: a direct
// route-guard import here would drag NextAuth's whole auth.ts chain into
// this module, breaking test isolation for anything that imports it).
// handleApiError()'s `instanceof HttpError` check still catches it correctly.
export class SearchError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "SearchError";
  }
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_MUTUAL_CANDIDATES_SCANNED = 200;
const MAX_COMPARE = 5;
const MAX_SHORTLIST_BULK_ADD = 100;

export type QuickFilterKey =
  | "NEW_PROFILES" | "UNDER_REVIEW" | "VERIFIED" | "ACTIVE" | "MATCHING" | "PROPOSAL_SENT"
  | "WAITING_FOR_RESPONSE" | "INTERESTED" | "MEETING_SCHEDULED" | "FINALIZED" | "MARRIED"
  | "RECENTLY_UPDATED" | "INCOMPLETE" | "RECENTLY_VERIFIED" | "FOLLOW_UP_DUE" | "ASSIGNED_TO_ME";

const QUICK_FILTER_STATUS: Partial<Record<QuickFilterKey, ProfileStatus>> = {
  NEW_PROFILES: "NEW", UNDER_REVIEW: "UNDER_REVIEW", ACTIVE: "ACTIVE", MATCHING: "MATCHING",
  PROPOSAL_SENT: "PROPOSAL_SENT", WAITING_FOR_RESPONSE: "WAITING_FOR_RESPONSE", INTERESTED: "INTERESTED",
  MEETING_SCHEDULED: "MEETING_ARRANGED", FINALIZED: "FINALIZED", MARRIED: "MARRIED",
};

function quickFilterWhere(key: QuickFilterKey, admin: SessionAdmin, now: Date): Prisma.ProfileWhereInput {
  const status = QUICK_FILTER_STATUS[key];
  if (status) return { status };
  switch (key) {
    case "VERIFIED":
      return { verified: true };
    case "RECENTLY_UPDATED":
      return { updatedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } };
    case "INCOMPLETE":
      return { profileCompletion: { lt: 80 } };
    case "RECENTLY_VERIFIED":
      return { verification: { is: { status: "VERIFIED", lastReviewedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } } };
    case "FOLLOW_UP_DUE":
      return { followUps: { some: { status: "PENDING", dueDate: { lte: now } } } };
    case "ASSIGNED_TO_ME":
      // AdminAssignment is polymorphic (resourceType/resourceId, no direct
      // Prisma relation to Profile) — handled by forceAssignedToMe in
      // searchProfiles() instead of a relation filter here.
      return {};
    default:
      return {};
  }
}

// spec §31 — excluded by default unless the caller holds search:advanced (or
// a broad role) AND explicitly asks for them.
function isElevated(admin: SessionAdmin): boolean {
  return hasBroadRecordAccess(admin.role) || admin.permissions.includes("search:advanced");
}

async function baseExclusions(admin: SessionAdmin, opts: { includeArchived?: boolean; includeSuspended?: boolean }): Promise<Prisma.ProfileWhereInput[]> {
  const and: Prisma.ProfileWhereInput[] = [{ softDeleted: false, accountStatus: "ACTIVE" }];
  const elevated = isElevated(admin);
  const statusExclusions: ProfileStatus[] = [];
  if (!(opts.includeArchived && elevated)) statusExclusions.push("ARCHIVED");
  if (!(opts.includeSuspended && elevated)) statusExclusions.push("SUSPENDED");
  if (statusExclusions.length) and.push({ status: { notIn: statusExclusions } });
  if (!(opts.includeSuspended && elevated)) {
    and.push({ restrictions: { none: { restrictionType: "CANNOT_MATCH", active: true } } });
  }
  const assignedIds = await getAssignedResourceIds(admin, "PROFILE");
  if (assignedIds) and.push({ id: { in: assignedIds } });
  return and;
}

function collectSensitiveFields(group: FilterGroup, out: Set<string>): void {
  for (const r of group.rules) {
    if ("op" in r && (r.op === "AND" || r.op === "OR") && "rules" in r) {
      collectSensitiveFields(r as FilterGroup, out);
    } else {
      const rule = r as { field: string };
      const def = getFieldDef(rule.field);
      if (def?.sensitivePermission) out.add(rule.field);
    }
  }
}

export interface SearchProfilesParams {
  filterGroup?: FilterGroup;
  quickFilter?: QuickFilterKey;
  search?: string;
  minIncome?: number;
  maxIncome?: number;
  cursor?: string | null;
  pageSize?: number;
  includeArchived?: boolean;
  includeSuspended?: boolean;
}

export interface SearchProfilesResult {
  items: CandidateCardDto[];
  total: number;
  nextCursor: string | null;
}

// The §35 core method — every other list-shaped search (searchByCriteria,
// the quick-filter chips) funnels through this.
export async function searchProfiles(admin: SessionAdmin, params: SearchProfilesParams): Promise<SearchProfilesResult> {
  if (!admin.permissions.includes("search:view")) throw new SearchError(403, "You do not have permission to search candidates.");

  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const now = new Date();
  const and = await baseExclusions(admin, params);
  const sensitiveFieldsUsed = new Set<string>();

  if (params.quickFilter === "ASSIGNED_TO_ME") {
    // Force-scoped regardless of role — even a broad-access admin explicitly
    // asking for "Assigned to Me" wants only their own assignments, unlike
    // the default scoping in baseExclusions() which skips broad roles entirely.
    const myRows = await prisma.adminAssignment.findMany({ where: { resourceType: "PROFILE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
    and.push({ id: { in: myRows.map((r) => r.resourceId) } });
  }

  if (params.filterGroup) {
    let validated: FilterGroup;
    try {
      validated = validateFilterGroup(params.filterGroup, admin.permissions);
    } catch (error) {
      if (error instanceof FilterValidationError) throw new SearchError(400, error.message);
      throw error;
    }
    if (!admin.permissions.includes("search:advanced") && !hasBroadRecordAccess(admin.role)) {
      throw new SearchError(403, "You do not have permission to use advanced filters.");
    }
    collectSensitiveFields(validated, sensitiveFieldsUsed);
    and.push(buildWhereFromFilterGroup(validated, now));
  }
  if (params.quickFilter) and.push(quickFilterWhere(params.quickFilter, admin, now));
  if (params.search?.trim()) {
    const q = params.search.trim();
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { profileCode: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (params.minIncome != null || params.maxIncome != null) {
    if (!admin.permissions.includes("sensitive:income:view") || !admin.permissions.includes("search:sensitive")) {
      throw new SearchError(403, "You do not have permission to search by income.");
    }
    sensitiveFieldsUsed.add("income");
    const incomeFilter: Prisma.IntFilter = {};
    if (params.minIncome != null) incomeFilter.gte = params.minIncome;
    if (params.maxIncome != null) incomeFilter.lte = params.maxIncome;
    and.push({ profession: { is: { monthlyIncome: incomeFilter } } });
  }

  const where: Prisma.ProfileWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.profile.findMany({
      where,
      include: profileListInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    prisma.profile.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;
  const items = pageRows.map((p) => toCandidateCardDto(p, admin.permissions));

  await recordSearchEvent({
    actorId: admin.id,
    searchType: "criteria",
    filterSummary: { quickFilter: params.quickFilter ?? null, hasFilterGroup: !!params.filterGroup, search: params.search ? true : false },
    resultCount: items.length,
  });
  if (sensitiveFieldsUsed.size > 0) {
    await recordSensitiveSearchEvent({ actorId: admin.id, searchType: "criteria", sensitiveFiltersUsed: [...sensitiveFieldsUsed], resultCount: items.length });
  }

  return { items, total, nextCursor };
}

export interface SearchByCriteriaParams {
  city?: string;
  country?: string;
  gender?: "MALE" | "FEMALE";
  ageMin?: number;
  ageMax?: number;
  maritalStatus?: string;
  educationLevel?: string;
  profession?: string;
  verifiedOnly?: boolean;
  pageSize?: number;
  cursor?: string | null;
}

// Thin convenience wrapper (spec §35) — builds a simple AND FilterGroup from
// flat criteria rather than duplicating searchProfiles()'s own logic.
export async function searchByCriteria(admin: SessionAdmin, criteria: SearchByCriteriaParams): Promise<SearchProfilesResult> {
  const rules: FilterGroup["rules"] = [];
  if (criteria.city) rules.push({ field: "city", op: "eq", value: criteria.city });
  if (criteria.country) rules.push({ field: "country", op: "eq", value: criteria.country });
  if (criteria.gender) rules.push({ field: "gender", op: "eq", value: criteria.gender });
  if (criteria.ageMin != null) rules.push({ field: "age", op: "gte", value: criteria.ageMin });
  if (criteria.ageMax != null) rules.push({ field: "age", op: "lte", value: criteria.ageMax });
  if (criteria.maritalStatus) rules.push({ field: "maritalStatus", op: "eq", value: criteria.maritalStatus });
  if (criteria.educationLevel) rules.push({ field: "educationLevel", op: "eq", value: criteria.educationLevel });
  if (criteria.profession) rules.push({ field: "profession", op: "contains", value: criteria.profession });
  if (criteria.verifiedOnly) rules.push({ field: "verified", op: "eq", value: true });

  return searchProfiles(admin, {
    filterGroup: rules.length ? { op: "AND", rules } : undefined,
    pageSize: criteria.pageSize,
    cursor: criteria.cursor,
  });
}

// spec §4 — exact LPP-###### lookup. Returns null identically whether the
// profile doesn't exist OR exists but the caller isn't authorized to see it
// (never reveals which, closing the enumeration/IDOR gap named in §52).
export async function searchByProfileId(admin: SessionAdmin, profileCode: string): Promise<CandidateCardDto | null> {
  if (!admin.permissions.includes("search:view")) throw new SearchError(403, "You do not have permission to search candidates.");
  const and = await baseExclusions(admin, {});
  const row = await prisma.profile.findFirst({
    where: { AND: [...and, { profileCode: { equals: profileCode.trim(), mode: "insensitive" } }] },
    include: profileListInclude,
  });
  await recordSearchEvent({ actorId: admin.id, searchType: "profile_id", filterSummary: { profileCodeSearched: true }, resultCount: row ? 1 : 0 });
  if (!row) return null;
  return toCandidateCardDto(row, admin.permissions);
}

// ---------- Mutual compatibility search (spec §15/§16/§17/§43) ----------

export type RequirementPriorityLabel = "HARD" | "PREFERRED" | "FLEXIBLE";

export interface ExplainableCandidate {
  candidate: CandidateCardDto;
  match: MatchResult;
  hardRequirementNotMet: boolean;
  priorityLabels: Partial<Record<MatchCategory, RequirementPriorityLabel>>;
  missingInformation: MatchCategory[];
}

// Presentation-layer synthesis (plan architecture decision 3) — age/
// location/profession use the real stored PartnerPreference priority;
// every other category falls back to the global AppSettings hard-
// requirement toggle (HARD) or "did the applicant state anything" (PREFERRED
// vs FLEXIBLE). Never a claim that every category has its own stored
// priority — disclosed in the STEP 20 plan.
function labelPriorities(
  source: MatchableProfile,
  hardRequirements: Partial<Record<MatchCategory, boolean>>
): Partial<Record<MatchCategory, RequirementPriorityLabel>> {
  const labels: Partial<Record<MatchCategory, RequirementPriorityLabel>> = {};
  const p = source.preference;
  const stated: Partial<Record<MatchCategory, boolean>> = {
    age: p.minAge != null || p.maxAge != null,
    location: !!(p.preferredCity || p.preferredCountry || p.preferredArea),
    education: !!p.minEducation,
    profession: !!(p.professionPreference && p.professionPreference.toUpperCase() !== "ANY"),
    income: !(p.incomeFlexible ?? true) || p.minIncome != null || p.maxIncome != null,
    maritalStatus: !!(p.maritalStatusPreference && p.maritalStatusPreference.toUpperCase() !== "ANY"),
    height: p.minHeightCm != null || p.maxHeightCm != null,
    family: !!(p.familyTypePreference || p.familyBackgroundPreference),
    religious: !!source.religion,
    lifestyle: source.smoking != null || source.drinking != null,
    languages: !!source.languages,
  };
  const explicitPriority: Partial<Record<MatchCategory, RequirementPriorityLabel>> = {
    age: p.agePriority === "MUST_HAVE" ? "HARD" : p.agePriority === "FLEXIBLE" ? "FLEXIBLE" : undefined,
    location: p.locationPriority === "MUST_HAVE" ? "HARD" : p.locationPriority === "FLEXIBLE" ? "FLEXIBLE" : undefined,
    profession: p.professionPriority === "MUST_HAVE" ? "HARD" : p.professionPriority === "FLEXIBLE" ? "FLEXIBLE" : undefined,
  };
  const categories: MatchCategory[] = ["age", "location", "education", "profession", "income", "maritalStatus", "height", "family", "religious", "lifestyle", "languages"];
  for (const cat of categories) {
    if (explicitPriority[cat]) {
      labels[cat] = explicitPriority[cat];
      continue;
    }
    if (hardRequirements[cat]) {
      labels[cat] = "HARD";
    } else {
      labels[cat] = stated[cat] ? "PREFERRED" : "FLEXIBLE";
    }
  }
  return labels;
}

export interface FindMutualCandidatesParams {
  filterGroup?: FilterGroup;
  pageSize?: number;
  cursor?: string | null;
}

export async function findMutualCandidates(admin: SessionAdmin, sourceProfileId: string, params: FindMutualCandidatesParams = {}): Promise<{ items: ExplainableCandidate[]; total: number; nextCursor: string | null }> {
  if (!admin.permissions.includes("candidate:recommend")) throw new SearchError(403, "You do not have permission to find mutual candidates.");

  const source = await prisma.profile.findUnique({ where: { id: sourceProfileId }, include: matchableInclude });
  if (!source) throw new SearchError(404, "Source profile not found.");
  const assignedIds = await getAssignedResourceIds(admin, "PROFILE");
  if (assignedIds && !assignedIds.includes(source.id)) throw new SearchError(403, "This profile is not assigned to you.");

  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const and = await baseExclusions(admin, {});
  and.push({ id: { not: source.id } });
  and.push({ gender: source.gender === "MALE" ? "FEMALE" : "MALE" }); // spec §15 — opposite-gender candidate pool, never inferred beyond the stored value

  if (params.filterGroup) {
    let validated: FilterGroup;
    try {
      validated = validateFilterGroup(params.filterGroup, admin.permissions);
    } catch (error) {
      if (error instanceof FilterValidationError) throw new SearchError(400, error.message);
      throw error;
    }
    and.push(buildWhereFromFilterGroup(validated));
  }

  const candidates = await prisma.profile.findMany({
    where: { AND: and },
    include: matchableInclude,
    orderBy: [{ createdAt: "desc" }],
    take: MAX_MUTUAL_CANDIDATES_SCANNED,
  });

  const { weights, hardRequirements, enabled } = await loadMatchConfig();
  const sourceMatchable = toMatchable(source);
  const priorityLabels = labelPriorities(sourceMatchable, hardRequirements);

  const scored: ExplainableCandidate[] = await Promise.all(
    candidates.map(async (c) => {
      const match = scoreMatch(sourceMatchable, toMatchable(c), weights, hardRequirements, enabled);
      const listRow = await prisma.profile.findUnique({ where: { id: c.id }, include: profileListInclude });
      const missingInformation = match.breakdown.filter((b) => b.status === "unknown").map((b) => b.category);
      return {
        candidate: toCandidateCardDto(listRow!, admin.permissions),
        match,
        hardRequirementNotMet: match.excludedByHardRequirement,
        priorityLabels,
        missingInformation,
      };
    })
  );

  // spec §16 — a failed hard requirement is labeled, never silently hidden;
  // it's still sorted below fully-qualifying candidates.
  scored.sort((a, b) => {
    if (a.hardRequirementNotMet !== b.hardRequirementNotMet) return a.hardRequirementNotMet ? 1 : -1;
    return b.match.total - a.match.total;
  });

  const start = params.cursor ? scored.findIndex((s) => s.candidate.id === params.cursor) + 1 : 0;
  const page = scored.slice(start, start + pageSize);
  const nextCursor = start + pageSize < scored.length ? page[page.length - 1]?.candidate.id ?? null : null;

  await recordSearchEvent({ actorId: admin.id, searchType: "mutual", sourceProfileId, filterSummary: { candidatesScanned: candidates.length }, resultCount: page.length });

  return { items: page, total: scored.length, nextCursor };
}

// ---------- Compare candidates (spec §26) ----------

export interface CompareCandidatesResult {
  profiles: Array<ReturnType<typeof toCandidateCardDto> & { maritalStatus: string; heightCm: number; verificationStatus: string | null }>;
}

export async function compareCandidates(admin: SessionAdmin, profileIds: string[]): Promise<CompareCandidatesResult> {
  if (!admin.permissions.includes("candidate:compare")) throw new SearchError(403, "You do not have permission to compare candidates.");
  const ids = [...new Set(profileIds)];
  if (ids.length < 2) throw new SearchError(400, "Select at least 2 candidates to compare.");
  if (ids.length > MAX_COMPARE) throw new SearchError(400, `You can compare at most ${MAX_COMPARE} candidates at once.`);

  const assignedIds = await getAssignedResourceIds(admin, "PROFILE");
  if (assignedIds) {
    const unauthorized = ids.filter((id) => !assignedIds.includes(id));
    if (unauthorized.length) throw new SearchError(403, "One or more of these profiles is not assigned to you.");
  }

  const rows = await prisma.profile.findMany({
    where: { id: { in: ids } },
    include: { ...profileListInclude, verification: { select: { status: true } } },
  });
  if (rows.length !== ids.length) throw new SearchError(404, "One or more profiles could not be found.");

  const profiles = rows.map((r) => ({
    ...toCandidateCardDto(r as unknown as ProfileListItem, admin.permissions),
    maritalStatus: r.maritalStatus,
    heightCm: r.heightCm,
    verificationStatus: r.verification?.status ?? null,
  }));

  await writeAudit({ action: "CANDIDATE_COMPARED", adminId: admin.id, meta: { profileIds: ids } });
  await recordSearchEvent({ actorId: admin.id, searchType: "compare", filterSummary: { count: ids.length }, resultCount: ids.length });

  return { profiles };
}

// ---------- Shortlists (spec §28/§29/§45) ----------

export async function createShortlist(admin: SessionAdmin, params: { name: string; description?: string; sourceProfileId?: string | null; profileIds?: string[] }) {
  if (!admin.permissions.includes("candidate:shortlist")) throw new SearchError(403, "You do not have permission to create shortlists.");
  const shortlistCode = await nextSequenceCode("SHORT");
  const profileIds = [...new Set(params.profileIds ?? [])].slice(0, MAX_SHORTLIST_BULK_ADD);

  const shortlist = await prisma.shortlist.create({
    data: {
      shortlistCode,
      ownerId: admin.id,
      sourceProfileId: params.sourceProfileId ?? null,
      name: params.name,
      description: params.description ?? null,
      items: profileIds.length
        ? { create: profileIds.map((profileId, index) => ({ profileId, position: index, addedById: admin.id })) }
        : undefined,
    },
    include: { items: true },
  });

  await writeAudit({ action: "SHORTLIST_CREATED", adminId: admin.id, meta: { shortlistId: shortlist.id, shortlistCode, itemCount: profileIds.length } });
  return shortlist;
}

export async function addToShortlist(admin: SessionAdmin, shortlistId: string, profileId: string, adminNote?: string) {
  const shortlist = await prisma.shortlist.findUnique({ where: { id: shortlistId } });
  if (!shortlist) throw new SearchError(404, "Shortlist not found.");
  if (shortlist.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) throw new SearchError(403, "You do not have permission to modify this shortlist.");

  // @@unique([shortlistId, profileId]) makes a repeat add a no-op (spec §45).
  const item = await prisma.shortlistItem.upsert({
    where: { shortlistId_profileId: { shortlistId, profileId } },
    update: { adminNote: adminNote ?? undefined },
    create: { shortlistId, profileId, addedById: admin.id, adminNote: adminNote ?? null },
  });
  await writeAudit({ action: "SHORTLIST_ITEM_ADDED", adminId: admin.id, meta: { shortlistId, profileId } });
  return item;
}

export async function removeFromShortlist(admin: SessionAdmin, shortlistId: string, itemId: string) {
  const shortlist = await prisma.shortlist.findUnique({ where: { id: shortlistId } });
  if (!shortlist) throw new SearchError(404, "Shortlist not found.");
  if (shortlist.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) throw new SearchError(403, "You do not have permission to modify this shortlist.");
  await prisma.shortlistItem.delete({ where: { id: itemId } });
  await writeAudit({ action: "SHORTLIST_ITEM_REMOVED", adminId: admin.id, meta: { shortlistId, itemId } });
}

export async function getShortlist(admin: SessionAdmin, id: string) {
  const shortlist = await prisma.shortlist.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" }, include: { profile: { include: profileListInclude } } } },
  });
  if (!shortlist) throw new SearchError(404, "Shortlist not found.");
  if (shortlist.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) throw new SearchError(403, "You do not have permission to view this shortlist.");
  return {
    ...shortlist,
    items: shortlist.items.map((item) => ({ id: item.id, position: item.position, adminNote: item.adminNote, candidate: toCandidateCardDto(item.profile, admin.permissions) })),
  };
}

export async function updateShortlistStatus(admin: SessionAdmin, id: string, status: ShortlistStatus) {
  const shortlist = await prisma.shortlist.findUnique({ where: { id } });
  if (!shortlist) throw new SearchError(404, "Shortlist not found.");
  if (shortlist.ownerId !== admin.id && !hasBroadRecordAccess(admin.role)) throw new SearchError(403, "You do not have permission to modify this shortlist.");
  const updated = await prisma.shortlist.update({ where: { id }, data: { status } });
  await writeAudit({ action: "SHORTLIST_STATUS_CHANGED", adminId: admin.id, meta: { shortlistId: id, status } });
  return updated;
}

// ---------- Saved searches / presets (spec §19/§20) ----------

export async function saveSearchPreset(admin: SessionAdmin, params: { name: string; description?: string; filterGroup: FilterGroup; visibility?: SavedSearchVisibility; departmentId?: string | null }) {
  if (!admin.permissions.includes("search:saved:create")) throw new SearchError(403, "You do not have permission to save search presets.");
  validateFilterGroup(params.filterGroup, admin.permissions); // re-validate before persisting — never trust a client-supplied filter blindly
  const searchCode = await nextSequenceCode("SRCH");
  if ((params.visibility === "TEAM" || params.visibility === "DEPARTMENT" || params.visibility === "ORGANIZATION") && !admin.permissions.includes("search:saved:edit")) {
    throw new SearchError(403, "You do not have permission to create a shared preset.");
  }
  const preset = await prisma.savedSearch.create({
    data: {
      searchCode,
      ownerId: admin.id,
      name: params.name,
      description: params.description ?? null,
      filterJson: JSON.parse(JSON.stringify(params.filterGroup)),
      visibility: params.visibility ?? "PRIVATE",
      departmentId: params.departmentId ?? null,
    },
  });
  await writeAudit({ action: "SAVED_SEARCH_CREATED", adminId: admin.id, meta: { presetId: preset.id, searchCode, visibility: preset.visibility } });
  return preset;
}

export async function getSearchPresets(admin: SessionAdmin) {
  if (!admin.permissions.includes("search:saved:view")) throw new SearchError(403, "You do not have permission to view saved searches.");
  const self = await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { departmentId: true } });
  return prisma.savedSearch.findMany({
    where: {
      OR: [
        { ownerId: admin.id },
        { visibility: "ORGANIZATION" },
        { visibility: "TEAM" },
        ...(self?.departmentId ? [{ visibility: "DEPARTMENT" as const, departmentId: self.departmentId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getRecentSearches(admin: SessionAdmin) {
  return prisma.searchHistory.findMany({ where: { actorId: admin.id }, orderBy: { createdAt: "desc" }, take: 20 });
}
