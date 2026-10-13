import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { listConfigChanges, type ConfigKind } from "@/lib/platform/config-change";

export const dynamic = "force-dynamic";

const KINDS: ConfigKind[] = ["SETTING", "FEATURE_FLAG", "SYSTEM_CONTROL", "MAINTENANCE", "CHANGE_FREEZE", "ANNOUNCEMENT", "PROVIDER"];

// The configuration change log, newest first, cursor-paginated. Values were stored already redacted (secrets are never kept), and nothing here is editable.
export async function GET(req: Request) {
  try {
    await requireAdmin("platform:configuration:view");
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const out = await listConfigChanges({
      kind: kind && (KINDS as string[]).includes(kind) ? (kind as ConfigKind) : undefined,
      key: url.searchParams.get("key")?.slice(0, 120) || undefined,
      actorId: url.searchParams.get("actor")?.slice(0, 60) || undefined,
      after: url.searchParams.get("after")?.slice(0, 60) || undefined,
    });
    // Show who made each change by name; the id stays the stable reference.
    const ids = [...new Set(out.items.map((i) => i.actorId).filter((x): x is string => !!x))];
    const people = ids.length ? await prisma.adminUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const names = new Map(people.map((a) => [a.id, a.name]));
    return NextResponse.json({ ...out, items: out.items.map((i) => ({ ...i, actorName: i.actorId ? names.get(i.actorId) ?? null : null })) });
  } catch (error) {
    return handleApiError(error);
  }
}