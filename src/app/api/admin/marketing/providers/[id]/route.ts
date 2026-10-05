import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { disconnectProvider } from "@/lib/marketing/provider-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";
import type { MarketingProviderKey } from "@prisma/client";

const KEYS: MarketingProviderKey[] = ["SANDBOX", "META", "GOOGLE", "TIKTOK"];

// [id] is the provider key (one connection row per provider).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:providers:manage");
    const { id } = await params;
    const key = id.toUpperCase() as MarketingProviderKey;
    if (!KEYS.includes(key)) throw new HttpError(404, "Unknown provider.");
    const b = await readBody(req);
    const outcome = await disconnectProvider(admin, key, str(b, "reason", { required: true, max: 500 }));
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return NextResponse.json({ status: outcome.status });
  } catch (error) {
    return marketingError(error);
  }
}
