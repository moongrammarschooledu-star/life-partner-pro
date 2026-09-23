import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getRecentSearches } from "@/lib/search/candidate-search";

export async function GET() {
  try {
    const admin = await requireAdmin("search:view");
    const items = await getRecentSearches(admin);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
