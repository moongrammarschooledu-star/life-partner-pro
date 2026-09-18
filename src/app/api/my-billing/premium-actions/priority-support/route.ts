import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { hasEntitlement, consumeUsage } from "@/lib/finance/entitlements";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import { notifyCaseCreated } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";

const FEATURE_KEY = "support.priority";

// Spec §38/§39 — the first of two concrete premium actions proving the
// entitlement engine is real and server-enforced. Every existing Steps
// 1-13 support/case flow stays exactly as free as it is today; this is a
// NEW action, not a retrofit of an existing one (confirmed scope with the
// user). 1. Authenticate 2. Check entitlement 3. Check usage limit
// 4. Execute 5. Record usage — spec §39's exact sequence.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `priority-support:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  if (!(await hasEntitlement(profileId, FEATURE_KEY))) {
    return NextResponse.json({ error: "Priority support requires an active subscription that includes this feature." }, { status: 403 });
  }

  const { subject, description } = (await req.json()) as { subject?: string; description?: string };
  if (!subject?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Subject and description are required." }, { status: 400 });
  }

  const consumed = await consumeUsage(profileId, FEATURE_KEY);
  if (!consumed) {
    return NextResponse.json({ error: "You have reached your priority support request limit for this period." }, { status: 403 });
  }

  const caseNumber = await nextCaseNumber("SUPPORT");
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates("HIGH");

  const created = await prisma.case.create({
    data: {
      caseNumber,
      type: "SUPPORT",
      category: "OTHER_SUPPORT",
      subject: subject.trim(),
      description: description.trim(),
      priority: "HIGH",
      reporterProfileId: profileId,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  await writeAudit({ action: "ENTITLEMENT_GRANTED", targetProfileId: profileId, meta: { featureKey: FEATURE_KEY, caseId: created.id } });
  await notifyCaseCreated(created.id, profileId);

  return NextResponse.json({ id: created.id, caseNumber });
}
