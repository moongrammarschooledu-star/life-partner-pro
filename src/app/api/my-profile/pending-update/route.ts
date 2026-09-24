import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// STEP 21 — the missing "view my pending update requests" screen. The
// submit side (POST /api/update-request) already existed; this only adds a
// read view of the same PendingUpdate row.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const pending = await prisma.pendingUpdate.findUnique({ where: { profileId } });
  if (!pending) return NextResponse.json({ pending: null });

  return NextResponse.json({
    pending: {
      submittedAt: pending.submittedAt,
      changes: JSON.parse(pending.payload),
    },
  });
}
