import { NextResponse } from "next/server";
import { getPublicPackages } from "@/lib/public-site/packages";

// Public package browser — no auth required to see what's available,
// mirroring how registration itself is public. The same list feeds the public pricing and home pages.
export async function GET() {
  const items = await getPublicPackages();
  return NextResponse.json({ items });
}
