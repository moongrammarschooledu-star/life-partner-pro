import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { searchProfiles, searchByCriteria, searchByProfileId, type SearchProfilesParams } from "@/lib/search/candidate-search";
import type { FilterGroup } from "@/lib/search/filter-builder";
import type { QuickFilterKey } from "@/lib/search/candidate-search";

// spec §34 — GET is the quick/simple path (query params), POST accepts the
// full structured body (Smart Filter Builder FilterGroup, quick filters,
// income range, pagination). Both funnel into the same searchProfiles()
// service — see src/lib/search/candidate-search.ts.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("search:view");
    const { searchParams } = new URL(req.url);

    const profileCode = searchParams.get("profileCode");
    if (profileCode) {
      const result = await searchByProfileId(admin, profileCode);
      // spec §4 — identical shape whether not-found or unauthorized; never
      // reveal which via a different status code or body shape.
      return NextResponse.json({ item: result });
    }

    const result = await searchByCriteria(admin, {
      city: searchParams.get("city") ?? undefined,
      country: searchParams.get("country") ?? undefined,
      gender: (searchParams.get("gender") as "MALE" | "FEMALE" | null) ?? undefined,
      ageMin: searchParams.get("ageMin") ? Number(searchParams.get("ageMin")) : undefined,
      ageMax: searchParams.get("ageMax") ? Number(searchParams.get("ageMax")) : undefined,
      maritalStatus: searchParams.get("maritalStatus") ?? undefined,
      educationLevel: searchParams.get("educationLevel") ?? undefined,
      profession: searchParams.get("profession") ?? undefined,
      verifiedOnly: searchParams.get("verifiedOnly") === "true",
      pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      cursor: searchParams.get("cursor"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("search:view");
    const body = (await req.json()) as {
      filterGroup?: FilterGroup;
      quickFilter?: QuickFilterKey;
      search?: string;
      minIncome?: number;
      maxIncome?: number;
      cursor?: string | null;
      pageSize?: number;
      includeArchived?: boolean;
      includeSuspended?: boolean;
    };
    if (body.filterGroup && typeof body.filterGroup !== "object") throw new ApiError(400, "filterGroup must be an object.");

    const params: SearchProfilesParams = {
      filterGroup: body.filterGroup,
      quickFilter: body.quickFilter,
      search: body.search,
      minIncome: body.minIncome,
      maxIncome: body.maxIncome,
      cursor: body.cursor,
      pageSize: body.pageSize,
      includeArchived: body.includeArchived,
      includeSuspended: body.includeSuspended,
    };
    const result = await searchProfiles(admin, params);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
