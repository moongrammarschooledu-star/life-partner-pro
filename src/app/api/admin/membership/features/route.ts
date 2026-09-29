import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { listFeatures, createFeatureDefinition, setFeatureActive } from "@/lib/finance/catalog";

export async function GET() {
  try {
    await requireAdmin("finance:entitlements:view");
    const items = await listFeatures(false);
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:entitlements:manage");
    const { key, label, description, category, usageLimitType } = (await req.json()) as {
      key?: string; label?: string; description?: string; category?: string; usageLimitType?: string;
    };
    if (!key?.trim() || !label?.trim()) throw new ApiError(400, "A key and label are required.");
    const created = await createFeatureDefinition(admin.id, { key: key.trim(), label: label.trim(), description, category, usageLimitType: usageLimitType as never });
    return NextResponse.json(created);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("finance:entitlements:manage");
    const { key, active } = (await req.json()) as { key?: string; active?: boolean };
    if (!key || active === undefined) throw new ApiError(400, "A key and active flag are required.");
    const updated = await setFeatureActive(admin.id, key, active);
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
