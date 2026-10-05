import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createWorkflow, listWorkflows } from "@/lib/engagement/workflow-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("engagement:workflows:view");
    const rows = await listWorkflows();
    return NextResponse.json({ items: rows.map((w) => ({ id: w.id, code: w.code, name: w.name, description: w.description, trigger: w.trigger, status: w.status, currentVersion: w.currentVersion, publishedVersionId: w.publishedVersionId, latestVersion: w.versions[0] ?? null, runs: w._count.runs, updatedAt: w.updatedAt })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("engagement:workflows:create");
    const b = await readBody(req);
    const wf = await createWorkflow(admin, { name: str(b, "name", { required: true, max: 120 }), description: str(b, "description", { max: 400 }) || null, trigger: str(b, "trigger", { required: true, max: 60 }), definition: b.definition, changeSummary: str(b, "changeSummary", { max: 300 }) || null });
    return NextResponse.json({ id: wf.id, code: wf.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
