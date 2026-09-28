import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { updateProviderTemplate } from "@/lib/communications/template-service";
import { readJson, str } from "@/lib/communications/route-utils";

// Records the provider-side template (WhatsApp) and its approval status. The status is what the provider told us - it is set by a
// provider manager, never inferred - and a WhatsApp template cannot be activated until it reads APPROVED.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const { id } = await params;
    const body = await readJson(req);
    return NextResponse.json(
      await updateProviderTemplate(admin, id, {
        providerTemplateName: str(body.providerTemplateName, "providerTemplateName", { max: 120, optional: true }) || undefined,
        providerTemplateId: str(body.providerTemplateId, "providerTemplateId", { max: 120, optional: true }) || undefined,
        providerCategory: str(body.providerCategory, "providerCategory", { max: 60, optional: true }) || undefined,
        providerStatus: str(body.providerStatus, "providerStatus", { max: 30, optional: true }) || undefined,
      })
    );
  } catch (error) {
    return handleApiError(error);
  }
}
