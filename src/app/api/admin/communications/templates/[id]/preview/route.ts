import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { COMMUNICATION_VARIABLES, TemplateRenderError, renderTemplate } from "@/lib/communications/secure-renderer";

// Renders a template with SAMPLE values only (never a real recipient's data), so a reviewer can see exactly what would be sent
// and any problem the secure renderer would raise.
const SAMPLE: Record<string, string> = {
  firstName: "Sample",
  profileId: "LPP-000000",
  proposalId: "PRP-2026-000000",
  meetingDate: "2026-01-15",
  meetingTime: "10:30 UTC",
  supportCaseId: "CASE-2026-000000",
  verificationStatus: "under review",
  applicationStatus: "received",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("communications:templates:view");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const template = await prisma.communicationTemplate.findUnique({ where: { id }, include: { versions: true } });
    if (!template) throw new ApiError(404, "Template not found.");
    const version = typeof body?.version === "number" ? template.versions.find((v) => v.version === body.version) : template.versions.sort((a, b) => b.version - a.version)[0];
    if (!version) throw new ApiError(404, "Template version not found.");
    try {
      const rendered = renderTemplate({ subject: version.subject, body: version.body, values: SAMPLE, allowed: COMMUNICATION_VARIABLES });
      return NextResponse.json({ ok: true, version: version.version, subject: rendered.subject, text: rendered.text, html: template.channel === "EMAIL" ? rendered.html : null, usedVariables: rendered.usedVariables });
    } catch (error) {
      if (error instanceof TemplateRenderError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: 422 });
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
