import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { unpublishForm } from "@/lib/marketing/form-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:forms:manage");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await unpublishForm(admin, id, str(b, "reason", { required: true, max: 500 })));
  } catch (error) {
    return marketingError(error);
  }
}
