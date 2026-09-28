import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { closeThread } from "@/lib/communications/thread-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:send");
    const { id } = await params;
    const thread = await closeThread(admin, id);
    return NextResponse.json({ id: thread.id, status: thread.status });
  } catch (error) {
    return handleApiError(error);
  }
}
