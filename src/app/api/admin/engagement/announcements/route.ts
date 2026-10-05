import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { createAnnouncement, listAnnouncements } from "@/lib/engagement/announcement-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:announcements:view");
    const status = new URL(req.url).searchParams.get("status") ?? undefined;
    const rows = await listAnnouncements({ status });
    return NextResponse.json({ items: rows.map((a) => ({ id: a.id, code: a.code, title: a.title, language: a.language, status: a.status, targeting: a.targeting, startAt: a.startAt, endAt: a.endAt, dismissals: a._count.dismissals, updatedAt: a.updatedAt })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("engagement:announcements:create");
    const b = await readBody(req);
    const a = await createAnnouncement(admin, { title: str(b, "title", { required: true, max: 160 }), body: str(b, "body", { required: true, max: 1200 }), language: str(b, "language", { max: 2 }) || "EN", targeting: b.targeting, startAt: (b.startAt as string | null | undefined) ?? null, endAt: (b.endAt as string | null | undefined) ?? null });
    return NextResponse.json({ id: a.id, code: a.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
