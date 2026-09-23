import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// STEP 20 architecture decision 4 — two audit surfaces, written together so
// they can never drift apart (same "created together" convention as
// STEP 19's recordApprovalEvent()): SearchHistory (the general "Recent
// Searches" UX source, spec §21) and, only when a sensitive filter was
// used, CandidateSearchAudit (the compliance trail, spec §39) — both
// alongside the existing central AuditLog.

export async function recordSearchEvent(params: {
  actorId: string;
  searchType: "criteria" | "mutual" | "nl" | "profile_id" | "compare";
  sourceProfileId?: string | null;
  filterSummary: Record<string, unknown>;
  resultCount: number;
}): Promise<void> {
  await prisma.searchHistory.create({
    data: {
      actorId: params.actorId,
      searchType: params.searchType,
      sourceProfileId: params.sourceProfileId ?? null,
      filterSummary: JSON.parse(JSON.stringify(params.filterSummary)),
      resultCount: params.resultCount,
    },
  });
  await writeAudit({
    action: params.searchType === "mutual" ? "MUTUAL_MATCH_SEARCH_PERFORMED" : "SEARCH_PERFORMED",
    adminId: params.actorId,
    meta: { searchType: params.searchType, sourceProfileId: params.sourceProfileId ?? null, resultCount: params.resultCount },
  });
}

// spec §38's explicit example: log THAT a sensitive filter was used
// (e.g. "income"), never the raw threshold value the admin searched for.
export async function recordSensitiveSearchEvent(params: {
  actorId: string;
  searchType: string;
  sourceProfileId?: string | null;
  sensitiveFiltersUsed: string[];
  resultCount: number;
  reason?: string | null;
}): Promise<void> {
  await prisma.candidateSearchAudit.create({
    data: {
      actorId: params.actorId,
      searchType: params.searchType,
      sourceProfileId: params.sourceProfileId ?? null,
      sensitiveFiltersUsed: params.sensitiveFiltersUsed,
      resultCount: params.resultCount,
      reason: params.reason ?? null,
    },
  });
  await writeAudit({
    action: "SENSITIVE_SEARCH_PERFORMED",
    adminId: params.actorId,
    meta: { searchType: params.searchType, sourceProfileId: params.sourceProfileId ?? null, sensitiveFiltersUsed: params.sensitiveFiltersUsed, resultCount: params.resultCount },
  });
}
