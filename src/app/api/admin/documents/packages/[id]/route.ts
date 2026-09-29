import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getPackage } from "@/lib/documents/package-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("documents:export");
    const { id } = await params;
    return NextResponse.json(await getPackage(id));
  } catch (error) {
    return handleApiError(error);
  }
}
