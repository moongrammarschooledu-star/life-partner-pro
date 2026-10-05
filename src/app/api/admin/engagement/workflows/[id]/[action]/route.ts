import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { archiveWorkflow, pauseWorkflow, publishWorkflowVersion, resumeWorkflow, reviewWorkflowVersion, rollbackWorkflow, submitWorkflowVersion } from "@/lib/engagement/workflow-service";
import { HttpError } from "@/lib/http-error";
import { int, marketingError, readBody, str } from "@/lib/marketing/route-utils";

// submit | review | publish | pause | resume | archive | rollback. Each action has its own permission; reviewing needs
// engagement:approve and the service refuses a reviewer who wrote the version.
const PERMISSION = {
  submit: "engagement:workflows:edit",
  review: "engagement:approve",
  publish: "engagement:workflows:publish",
  pause: "engagement:workflows:pause",
  resume: "engagement:workflows:pause",
  archive: "engagement:workflows:publish",
  rollback: "engagement:workflows:publish",
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    if (!(action in PERMISSION)) throw new HttpError(404, "Unknown action.");
    const admin = await requireAdmin(PERMISSION[action as keyof typeof PERMISSION]);
    const b = await readBody(req);
    const reason = str(b, "reason", { max: 500 });
    switch (action) {
      case "submit":
        return NextResponse.json(await submitWorkflowVersion(admin, id, int(b, "version") as number));
      case "review":
        return NextResponse.json(await reviewWorkflowVersion(admin, id, int(b, "version") as number, b.decision === "REJECT" ? "REJECT" : "APPROVE", reason));
      case "publish": {
        const out = await publishWorkflowVersion(admin, id, int(b, "version") as number, reason);
        if (out.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: out.approvalCode, status: out.status }, { status: 202 });
        return NextResponse.json({ id: out.workflow.id, status: out.workflow.status });
      }
      case "pause":
        return NextResponse.json(await pauseWorkflow(admin, id, reason));
      case "resume":
        return NextResponse.json(await resumeWorkflow(admin, id, reason));
      case "archive":
        return NextResponse.json(await archiveWorkflow(admin, id, reason));
      default:
        return NextResponse.json(await rollbackWorkflow(admin, id, int(b, "version") as number, reason), { status: 201 });
    }
  } catch (error) {
    return marketingError(error);
  }
}
