import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { findSection, visibleLinks } from "@/lib/platform/sections";
import { getSectionSummary } from "@/lib/platform/section-summary";
import { listConfigChanges } from "@/lib/platform/config-change";

export const dynamic = "force-dynamic";

// A section hub: the current configuration of an existing area (read-only) plus links to its own editor. Needs the Control Center permission AND the
// section's own domain permission, both checked here.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = await requireAdmin("platform:control_center:view");
    const { key } = await params;
    const section = findSection(key);
    if (!section) throw new ApiError(404, "Not found.");
    if (section.requires && !admin.permissions.includes(section.requires)) throw new ApiError(403, "Forbidden: insufficient permissions");
    const summary = await getSectionSummary(section.key);
    const recent = admin.permissions.includes("platform:configuration:view") ? (await listConfigChanges({ limit: 5 })).items.map((c) => ({ id: c.id, kind: c.kind, key: c.key, version: c.version, createdAt: c.createdAt, reason: c.reason })) : [];
    return NextResponse.json({ section: { key: section.key, label: section.label, group: section.group, description: section.description, page: section.page ?? null }, links: visibleLinks(section, admin.permissions), summary, recentChanges: recent });
  } catch (error) {
    return handleApiError(error);
  }
}