import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { editTemplate, getTemplateWithVersions } from "@/lib/communications/template-service";
import { readJson, str } from "@/lib/communications/route-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("communications:templates:view");
    const { id } = await params;
    return NextResponse.json(await getTemplateWithVersions(id));
  } catch (error) {
    return handleApiError(error);
  }
}

// An edit never changes an ACTIVE version in place: it creates a new DRAFT version that must be reviewed, approved and activated.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:templates:edit");
    const { id } = await params;
    const body = await readJson(req);
    const version = await editTemplate(admin, id, {
      subject: body.subject === undefined ? undefined : body.subject === null ? null : str(body.subject, "subject", { max: 300, optional: true }),
      body: body.body === undefined ? undefined : str(body.body, "body", { max: 4000 }),
      changeReason: str(body.changeReason, "changeReason", { max: 300 }),
    });
    return NextResponse.json(version);
  } catch (error) {
    return handleApiError(error);
  }
}
