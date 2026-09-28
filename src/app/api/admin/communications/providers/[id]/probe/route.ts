import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { probeProvider } from "@/lib/communications/provider-service";

// Checks the provider's own health endpoint with the server-side credentials. No message is sent to anyone.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const { id } = await params;
    return NextResponse.json(await probeProvider(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}
