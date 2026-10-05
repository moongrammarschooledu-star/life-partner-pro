import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { connectProvider, listProviderStatuses } from "@/lib/marketing/provider-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";
import type { MarketingProviderKey } from "@prisma/client";

const KEYS: MarketingProviderKey[] = ["SANDBOX", "META", "GOOGLE", "TIKTOK"];

// Status only: which providers exist, whether each needed environment variable is SET (a boolean per name — never a
// value), connection status, last sync/error. No secret, token or ciphertext is ever returned.
export async function GET() {
  try {
    await requireAdmin("marketing:providers:view");
    return NextResponse.json({ items: await listProviderStatuses() }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:providers:manage");
    const b = await readBody(req);
    const key = str(b, "providerKey", { required: true }) as MarketingProviderKey;
    if (!KEYS.includes(key)) throw new HttpError(400, "Unknown provider.");
    const outcome = await connectProvider(admin, key, str(b, "reason", { required: true, max: 500 }));
    if (outcome.approvalRequired) return NextResponse.json({ approvalRequired: true, approvalCode: outcome.approvalCode, status: outcome.status }, { status: 202 });
    return NextResponse.json({ status: outcome.status });
  } catch (error) {
    return marketingError(error);
  }
}
