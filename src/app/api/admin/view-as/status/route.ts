import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveViewAs } from "@/lib/view-as";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ active: false });

  const viewAs = await getActiveViewAs(session.user.id);
  if (!viewAs) return NextResponse.json({ active: false });

  return NextResponse.json({ active: true, targetName: viewAs.name, expiresAt: viewAs.expiresAt });
}
