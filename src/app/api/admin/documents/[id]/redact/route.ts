import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { redactDocument, type RedactionRegion } from "@/lib/documents/redaction-service";
import { str } from "@/lib/documents/route-utils";

function parseRegions(value: unknown): RedactionRegion[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(422, "At least one region is required.");
  return value.map((r) => {
    if (typeof r !== "object" || r === null) throw new ApiError(422, "Each region must be an object.");
    const { page, x, y, width, height } = r as Record<string, unknown>;
    if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) throw new ApiError(422, "Each region needs numeric x, y, width and height.");
    return { page: typeof page === "number" ? page : undefined, x: x as number, y: y as number, width: width as number, height: height as number };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:redact");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await redactDocument(admin, { documentId: id, regions: parseRegions(body.regions), reason: str(body.reason, "reason", { max: 500 }) });
    return NextResponse.json(result, { status: "approvalRequired" in result && result.approvalRequired ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
