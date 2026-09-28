import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { retryDeadLetter } from "@/lib/communications/send-service";

// Manual retry of a dead-lettered message (a permanent failure needs providers:manage - see retryDeadLetter).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:send");
    const { id } = await params;
    return NextResponse.json(await retryDeadLetter(id, { id: admin.id, permissions: admin.permissions }));
  } catch (error) {
    return handleApiError(error);
  }
}
