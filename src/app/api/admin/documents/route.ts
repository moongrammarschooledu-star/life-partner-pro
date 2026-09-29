import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { serializeDocument } from "@/lib/documents/serialize";
import { takeParam } from "@/lib/documents/route-utils";
import type { Prisma } from "@prisma/client";

// Admin document search (spec §22). Filters mirror the spec's list; sensitive filters (classification,
// profileId) still require documents:view like everything else here — there is no broader filter that
// bypasses it.
export async function GET(req: Request) {
  try {
    await requireAdmin("documents:view");
    const q = new URL(req.url).searchParams;
    const where: Prisma.DocumentWhereInput = {
      ...(q.get("typeKey") ? { typeKey: q.get("typeKey") as string } : {}),
      ...(q.get("categoryKey") ? { categoryKey: q.get("categoryKey") as string } : {}),
      ...(q.get("status") ? { status: q.get("status") as never } : {}),
      ...(q.get("verificationStatus") ? { verificationStatus: q.get("verificationStatus") as never } : {}),
      ...(q.get("classification") ? { classification: q.get("classification") as never } : {}),
      ...(q.get("profileId") ? { profileId: q.get("profileId") as string } : {}),
      ...(q.get("caseId") ? { caseId: q.get("caseId") as string } : {}),
      ...(q.get("includeArchived") === "true" ? {} : { archivedAt: null }),
      ...(q.get("includeDeleted") === "true" ? {} : { softDeletedAt: null }),
    };
    const items = await prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, take: takeParam(q.get("take"), 50, 200) });
    return NextResponse.json({ items: items.map(serializeDocument) });
  } catch (error) {
    return handleApiError(error);
  }
}
