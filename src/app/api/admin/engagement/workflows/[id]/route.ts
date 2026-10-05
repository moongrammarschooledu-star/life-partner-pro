import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getWorkflowDetail, saveWorkflowDraft } from "@/lib/engagement/workflow-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("engagement:workflows:view");
    const { id } = await params;
    return NextResponse.json(await getWorkflowDetail(id), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:workflows:edit");
    const { id } = await params;
    const b = await readBody(req);
    const v = await saveWorkflowDraft(admin, id, { definition: b.definition, name: str(b, "name", { max: 120 }) || undefined, description: b.description === undefined ? undefined : str(b, "description", { max: 400 }) || null, changeSummary: str(b, "changeSummary", { max: 300 }) || null });
    return NextResponse.json({ version: v.version, status: v.status });
  } catch (error) {
    return marketingError(error);
  }
}
