import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson, requireReason } from "@/lib/ops/admin-route";
import { planDuplicateMerge } from "@/lib/risk/duplicate-cluster-service";

// STEP 24 - PLANS a merge of a human-confirmed duplicate cluster: suggests a survivor, lists what must be
// preserved, checks legal holds and raises the STEP 19 DUPLICATE_MERGE approval. It NEVER merges anything; the data
// merge is a manual, reviewed operation performed by an authorised person after approval.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:merge");
    const { id } = await params;
    const body = await readJson<{ reason?: unknown }>(req);
    const plan = await planDuplicateMerge(id, admin, requireReason(body.reason));
    return NextResponse.json({ plan, executed: false });
  } catch (error) {
    return handleApiError(error);
  }
}
