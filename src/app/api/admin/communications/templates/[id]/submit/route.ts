import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { submitTemplate } from "@/lib/communications/template-service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:templates:edit");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await submitTemplate(admin, id, typeof body?.version === "number" ? body.version : undefined));
  } catch (error) {
    return handleApiError(error);
  }
}
