import { describe, it, expect } from "vitest";
import { parseReportFilters, buildProfileWhere, buildProposalWhere, buildMeetingWhere } from "@/lib/reports/where-builders";

function filtersWith(overrides: Partial<ReturnType<typeof parseReportFilters>>) {
  const base = parseReportFilters(new URLSearchParams());
  return { ...base, ...overrides };
}

describe("parseReportFilters", () => {
  it("parses query params into typed filters", () => {
    const params = new URLSearchParams({ city: "Lahore", minAge: "25", maxAge: "35", gender: "FEMALE" });
    const filters = parseReportFilters(params);
    expect(filters.city).toBe("Lahore");
    expect(filters.minAge).toBe(25);
    expect(filters.maxAge).toBe(35);
    expect(filters.gender).toBe("FEMALE");
  });

  it("defaults to a 30-day date range preset when none is given", () => {
    const filters = parseReportFilters(new URLSearchParams());
    expect(filters.dateRange.from).toBeInstanceOf(Date);
    expect(filters.dateRange.to).toBeInstanceOf(Date);
  });

  it("treats blank/whitespace string filters as absent", () => {
    const filters = parseReportFilters(new URLSearchParams({ city: "   " }));
    expect(filters.city).toBeUndefined();
  });
});

describe("buildProfileWhere", () => {
  it("always excludes soft-deleted profiles and applies the date range", () => {
    const where = buildProfileWhere(filtersWith({ city: undefined }));
    expect(where.softDeleted).toBe(false);
    expect(where.createdAt).toBeDefined();
  });

  it("applies a case-insensitive city filter", () => {
    const where = buildProfileWhere(filtersWith({ city: "Karachi" }));
    expect(where.city).toEqual({ contains: "Karachi", mode: "insensitive" });
  });

  it("converts an age range into a dateOfBirth filter", () => {
    const where = buildProfileWhere(filtersWith({ minAge: 25, maxAge: 35 }));
    expect(where.dateOfBirth).toBeDefined();
  });
});

describe("buildProposalWhere", () => {
  it("filters by proposal status directly", () => {
    const where = buildProposalWhere(filtersWith({ proposalStatus: "BOTH_INTERESTED" }));
    expect(where.status).toBe("BOTH_INTERESTED");
  });

  it("filters by an involved profile's city via OR across both sides", () => {
    const where = buildProposalWhere(filtersWith({ city: "Lahore" }));
    expect(where.OR).toHaveLength(2);
  });

  it("omits the OR clause entirely when no profile-level filter is set", () => {
    const where = buildProposalWhere(filtersWith({}));
    expect(where.OR).toBeUndefined();
  });
});

describe("buildMeetingWhere", () => {
  it("filters by assigned staff via createdById", () => {
    const where = buildMeetingWhere(filtersWith({ staffId: "admin-1" }));
    expect(where.createdById).toBe("admin-1");
  });
});
