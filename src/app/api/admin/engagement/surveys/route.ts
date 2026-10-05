import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { createSurvey } from "@/lib/engagement/feedback-service";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("engagement:feedback:view");
    const rows = await prisma.engagementSurvey.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { responses: true } } } });
    return NextResponse.json({ items: rows.map((s) => ({ id: s.id, code: s.code, title: s.title, kind: s.kind, status: s.status, questions: s.questions, responses: s._count.responses })) }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("engagement:feedback:manage");
    const b = await readBody(req);
    const s = await createSurvey(admin, { title: str(b, "title", { required: true, max: 160 }), kind: str(b, "kind", { required: true, max: 40 }), questions: b.questions });
    return NextResponse.json({ id: s.id, code: s.code }, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
