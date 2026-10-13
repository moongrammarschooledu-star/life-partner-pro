import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { searchConfiguration } from "@/lib/platform/search-export";

export const dynamic = "force-dynamic";

// Searches keys, labels, categories, providers, features and statuses the administrator may see. Stored values are never searched or returned.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("platform:control_center:view");
    const url = new URL(req.url);
    const items = await searchConfiguration(admin, { q: url.searchParams.get("q") ?? undefined, type: url.searchParams.get("type") ?? undefined, status: url.searchParams.get("status") ?? undefined, category: url.searchParams.get("category") ?? undefined });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}