import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { updateAnnouncement } from "@/lib/engagement/announcement-service";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:announcements:create");
    const { id } = await params;
    const b = await readBody(req);
    const a = await updateAnnouncement(admin, id, { title: str(b, "title", { required: true, max: 160 }), body: str(b, "body", { required: true, max: 1200 }), language: str(b, "language", { max: 2 }) || "EN", targeting: b.targeting, startAt: (b.startAt as string | null | undefined) ?? null, endAt: (b.endAt as string | null | undefined) ?? null });
    return NextResponse.json({ id: a.id, status: a.status });
  } catch (error) {
    return marketingError(error);
  }
}
