import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { placeHold } from "@/lib/privacy/data-hold";

export async function GET() {
  try {
    await requireAdmin("privacy:hold:view");
    const items = await prisma.dataHold.findMany({ orderBy: { placedAt: "desc" }, take: 100 });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("privacy:hold:manage");
    const { profileId, recordType, recordId, reason } = await req.json();
    if (!reason?.trim()) throw new Error("A reason is required.");
    if (!profileId && !(recordType && recordId)) throw new Error("Either a profile or a record type+id is required.");

    const hold = await placeHold({ profileId, recordType, recordId, reason, placedById: admin.id });
    return NextResponse.json(hold);
  } catch (error) {
    return handleApiError(error);
  }
}
