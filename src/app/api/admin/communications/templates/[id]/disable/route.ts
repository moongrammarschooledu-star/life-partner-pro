import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { disableTemplate } from "@/lib/communications/template-service";
import { readJson, str } from "@/lib/communications/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:templates:activate");
    const { id } = await params;
    const body = await readJson(req);
    return NextResponse.json(await disableTemplate(admin, id, str(body.reason, "reason", { max: 300 })));
  } catch (error) {
    return handleApiError(error);
  }
}
