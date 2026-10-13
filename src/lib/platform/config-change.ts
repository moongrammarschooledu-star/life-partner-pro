import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeConfigValue } from "@/lib/platform/config-values";
import type { PlatformEnvironment } from "@/lib/platform/environment";

// The configuration change log (STEP 36 §6, §50–§52). Append-only: nothing here updates or deletes a row. One row per change made through the control
// center, with a per-(kind, key) version number, who and which session, why, the approval if any, the environment, and the redacted before/after values.

export type ConfigKind = "SETTING" | "FEATURE_FLAG" | "SYSTEM_CONTROL" | "MAINTENANCE" | "CHANGE_FREEZE" | "ANNOUNCEMENT" | "PROVIDER" | "MOBILE_VERSION" | "MOBILE_RELEASE";

export interface RecordChangeInput {
  kind: ConfigKind;
  key: string;
  before: unknown;
  after: unknown;
  actor: { id: string; sid?: string } | null;
  reason?: string | null;
  approvalId?: string | null;
  environment: PlatformEnvironment;
  rolledBackFromId?: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

export async function recordConfigChange(input: RecordChangeInput): Promise<{ id: string; version: number }> {
  const before = input.before === undefined ? null : safeConfigValue(input.key, input.before);
  const after = input.after === undefined ? null : safeConfigValue(input.key, input.after);
  for (let attempt = 0; attempt < 4; attempt++) {
    const last = await prisma.platformConfigChange.findFirst({ where: { kind: input.kind, key: input.key }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    try {
      const row = await prisma.platformConfigChange.create({
        data: {
          kind: input.kind,
          key: input.key,
          version,
          before: before === null ? undefined : asJson(before),
          after: after === null ? undefined : asJson(after),
          actorId: input.actor?.id ?? null,
          sessionId: input.actor?.sid ?? null,
          reason: input.reason?.slice(0, 500) ?? null,
          approvalId: input.approvalId ?? null,
          environment: input.environment,
          rolledBackFromId: input.rolledBackFromId ?? null,
        },
        select: { id: true, version: true },
      });
      return row;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Could not allocate a configuration version. Please try again.");
}

export const HISTORY_PAGE_SIZE = 25;

export interface HistoryQuery {
  kind?: ConfigKind;
  key?: string;
  actorId?: string;
  /** Cursor: the id of the last row of the previous page (newest first). */
  after?: string;
  limit?: number;
}

export async function listConfigChanges(q: HistoryQuery) {
  const take = Math.min(100, Math.max(1, q.limit ?? HISTORY_PAGE_SIZE));
  const rows = await prisma.platformConfigChange.findMany({
    where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.key ? { key: q.key } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.after ? { cursor: { id: q.after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  return { items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null };
}

export async function getConfigChange(id: string) {
  return prisma.platformConfigChange.findUnique({ where: { id } });
}

/** The two newest versions of one item, for a quick "current vs previous" comparison. */
export async function latestTwo(kind: ConfigKind, key: string) {
  return prisma.platformConfigChange.findMany({ where: { kind, key }, orderBy: { version: "desc" }, take: 2 });
}
