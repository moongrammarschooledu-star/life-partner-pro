import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { listDeadLetters } from "@/lib/communications/send-service";
import { takeParam } from "@/lib/communications/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("communications:logs:view");
    const items = await listDeadLetters(takeParam(new URL(req.url).searchParams.get("take"), 100));
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
