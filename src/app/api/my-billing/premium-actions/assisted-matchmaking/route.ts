import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { hasEntitlement, consumeUsage } from "@/lib/finance/entitlements";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import { notifyCaseCreated } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";

const FEATURE_KEY = "assisted.matchmaking";

// The second of two concrete premium actions (spec §38/§39) — proves the
// entitlement engine server-enforces a usage-limited feature, not just a
// boolean grant.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `assisted-matchmaking:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  if (!(await hasEntitlement(profileId, FEATURE_KEY))) {
    return NextResponse.json({ error: "Assisted matchmaking requires an active subscription that includes this feature." }, { status: 403 });
  }

  const { description } = (await req.json()) as { description?: string };
  if (!description?.trim()) {
    return NextResponse.json({ error: "Please describe what you'd like assistance with." }, { status: 400 });
  }

  const consumed = await consumeUsage(profileId, FEATURE_KEY);
  if (!consumed) {
    return NextResponse.json({ error: "You have reached your assisted matchmaking request limit for this period." }, { status: 403 });
  }

  const caseNumber = await nextCaseNumber("SUPPORT");
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates("NORMAL");

  const created = await prisma.case.create({
    data: {
      caseNumber,
      type: "SUPPORT",
      category: "ASSISTED_MATCHMAKING_REQUEST",
      subject: "Assisted Matchmaking Request",
      description: description.trim(),
      reporterProfileId: profileId,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  await writeAudit({ action: "ENTITLEMENT_GRANTED", targetProfileId: profileId, meta: { featureKey: FEATURE_KEY, caseId: created.id } });
  await notifyCaseCreated(created.id, profileId);

  return NextResponse.json({ id: created.id, caseNumber });
}
