import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { readJson } from "@/lib/ops/admin-route";
import { addCaseNote } from "@/lib/risk/case-service";

// STEP 24 - append a reviewer note to the case timeline (append-only; notes are never edited or deleted).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("risk:review");
    const { id } = await params;
    const { note } = await readJson<{ note?: unknown }>(req);
    await addCaseNote(id, admin, typeof note === "string" ? note : "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
