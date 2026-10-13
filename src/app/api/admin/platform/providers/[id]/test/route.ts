import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { testProvider } from "@/lib/platform/providers";

export const dynamic = "force-dynamic";

// Test connection. Read-only and rate limited per administrator: it sends no message, charges nothing and changes nothing. The response is the outcome, a
// short redacted diagnostic and the latency; never a credential.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("platform:providers:manage");
    const limited = await enforceConfiguredLimit(req, "platform-provider-test", { limit: 6, windowMs: 60_000 }, admin.id);
    if (limited) return limited;
    const { id } = await params;
    return NextResponse.json(await testProvider(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}