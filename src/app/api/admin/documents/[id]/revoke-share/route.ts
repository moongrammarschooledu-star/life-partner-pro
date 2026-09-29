import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { revokeShare } from "@/lib/documents/sharing-service";
import { str } from "@/lib/documents/route-utils";

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("documents:revoke_share");
    const body = await req.json().catch(() => ({}));
    const updated = await revokeShare({ type: "ADMIN", id: admin.id, permissions: admin.permissions }, str(body.shareId, "shareId", { max: 60 }), str(body.reason, "reason", { max: 300 }));
    return NextResponse.json({ share: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
