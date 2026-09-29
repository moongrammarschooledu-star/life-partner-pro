import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { changeSubscriptionPackage } from "@/lib/finance/subscription";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";

// STEP 27 §23 — upgrade/downgrade. A positive net amount still requires a
// real payment: this route reports what's owed but does not itself charge
// anything (the caller directs the applicant to a fresh checkout for that
// amount) — never a hidden background charge.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-billing-checkout", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { newPackageId, effective } = (await req.json()) as { newPackageId?: string; effective?: "IMMEDIATE" | "NEXT_CYCLE" };
  if (!newPackageId) return NextResponse.json({ error: "A package is required." }, { status: 400 });

  const subscription = await prisma.subscription.findFirst({ where: { profileId, status: { in: ["ACTIVE", "TRIAL", "GRACE_PERIOD"] } } });
  if (!subscription) return NextResponse.json({ error: "No active subscription found." }, { status: 404 });

  try {
    const result = await changeSubscriptionPackage(subscription.id, newPackageId, effective ?? "IMMEDIATE");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change your package." }, { status: 400 });
  }
}
