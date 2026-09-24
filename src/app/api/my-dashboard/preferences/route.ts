import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { writeAudit } from "@/lib/audit";

// Cosmetic dashboard layout state only (pinned widgets, collapsed cards,
// last-visited tab) — never admin-reviewed, never affects
// matching/eligibility (see prisma/schema.prisma's DashboardPreference).
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const prefs = await prisma.dashboardPreference.findUnique({ where: { profileId } });
  return NextResponse.json({
    pinnedWidgets: prefs?.pinnedWidgets ? JSON.parse(prefs.pinnedWidgets) : [],
    collapsedCards: prefs?.collapsedCards ? JSON.parse(prefs.collapsedCards) : [],
    lastVisitedTab: prefs?.lastVisitedTab ?? null,
  });
}

export async function PATCH(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.pinnedWidgets !== undefined) data.pinnedWidgets = JSON.stringify(body.pinnedWidgets);
  if (body.collapsedCards !== undefined) data.collapsedCards = JSON.stringify(body.collapsedCards);
  if (body.lastVisitedTab !== undefined) data.lastVisitedTab = body.lastVisitedTab;

  const prefs = await prisma.dashboardPreference.upsert({
    where: { profileId },
    update: data,
    create: { profileId, ...data },
  });

  await writeAudit({ action: "DASHBOARD_PREFERENCE_UPDATED", targetProfileId: profileId });

  return NextResponse.json({
    pinnedWidgets: prefs.pinnedWidgets ? JSON.parse(prefs.pinnedWidgets) : [],
    collapsedCards: prefs.collapsedCards ? JSON.parse(prefs.collapsedCards) : [],
    lastVisitedTab: prefs.lastVisitedTab,
  });
}
