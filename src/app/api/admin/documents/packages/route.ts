import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createPackage, listPackages } from "@/lib/documents/package-service";
import { oneOf, str } from "@/lib/documents/route-utils";

const KINDS = ["VERIFICATION", "PROPOSAL", "SUPPORT_CASE", "COMPLIANCE"] as const;
const OWNER_TYPES = ["PROFILE", "FAMILY_MEMBER", "PROPOSAL", "SUPPORT_CASE", "RISK_CASE", "PRIVACY_REQUEST", "ADMIN", "SYSTEM"] as const;

export async function GET(req: Request) {
  try {
    await requireAdmin("documents:export");
    const q = new URL(req.url).searchParams;
    const items = await listPackages(q.get("ownerType") as never, q.get("ownerId") ?? undefined);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("documents:export");
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) throw new ApiError(422, "At least one document is required.");
    const pkg = await createPackage(admin, {
      kind: oneOf(body.kind, KINDS, "kind"),
      ownerType: oneOf(body.ownerType, OWNER_TYPES, "ownerType"),
      ownerId: str(body.ownerId, "ownerId", { max: 60 }),
      purpose: str(body.purpose, "purpose", { max: 300 }),
      documentIds: body.documentIds,
      expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : undefined,
    });
    return NextResponse.json(pkg, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
