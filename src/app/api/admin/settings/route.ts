import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("profile:view");
    const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin("settings:edit");
    const body = await req.json();

    const settings = await prisma.appSettings.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body },
    });

    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
