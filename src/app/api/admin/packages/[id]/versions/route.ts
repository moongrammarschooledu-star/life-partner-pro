import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createPackageVersion, listPackageVersions } from "@/lib/finance/package-version-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("finance:pricing:view");
    const { id } = await params;
    const versions = await listPackageVersions(id);
    return NextResponse.json({ items: versions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { name, description, priceMinor, currencyCode, changeReason } = (await req.json()) as {
      name?: string; description?: string; priceMinor?: number; currencyCode?: string; changeReason?: string;
    };
    if (!name?.trim() || !description?.trim()) throw new ApiError(400, "Name and description are required.");
    if (typeof priceMinor !== "number" || priceMinor < 0 || !Number.isInteger(priceMinor)) throw new ApiError(400, "A valid price amount is required.");
    if (!currencyCode) throw new ApiError(400, "A currency is required.");
    if (!changeReason?.trim()) throw new ApiError(400, "A change reason is required.");

    const version = await createPackageVersion(admin.id, { packageId: id, name: name.trim(), description: description.trim(), priceMinor, currencyCode, changeReason: changeReason.trim() });
    return NextResponse.json(version);
  } catch (error) {
    return handleApiError(error);
  }
}
