import type { PrismaClient } from "@prisma/client";
import { requestContext } from "@/lib/observability/context";

// Slow-query monitoring (spec §18) built on Prisma's non-invasive "query"
// event — no $extends, so the client's TypeScript type is unchanged. Only
// operation + table + duration are ever recorded: the SQL text and parameters
// are parsed for the table name and immediately discarded.

let thresholdMs = Number(process.env.SLOW_QUERY_THRESHOLD_MS) > 0 ? Number(process.env.SLOW_QUERY_THRESHOLD_MS) : 500;

export function setSlowQueryThreshold(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) thresholdMs = ms;
}

export function getSlowQueryThreshold(): number {
  return thresholdMs;
}

// Tables that back monitoring itself — ignored so recording a slow query can
// never recurse into recording another.
const MONITORING_TABLES = new Set(["SlowQueryStat", "ErrorEvent", "PerfSample", "RateLimitBucket", "CronTask", "CronTaskRun", "BackgroundJob"]);

export function parseQuery(sql: string): { operation: string; table: string } {
  const operation = (sql.trim().split(/\s+/, 1)[0] ?? "OTHER").toUpperCase().slice(0, 12);
  const match = /(?:FROM|INTO|UPDATE)\s+"[^"]+"\."([^"]+)"/i.exec(sql);
  return { operation, table: match?.[1] ?? "-" };
}

export function attachSlowQueryMonitor(client: PrismaClient): void {
  // Typed loosely on purpose: the generic-typed client's $on overload is
  // only visible when `log` is configured with emit:"event".
  (client as unknown as { $on: (event: "query", cb: (e: { query: string; duration: number }) => void) => void }).$on("query", (e) => {
    if (e.duration < thresholdMs) return;
    const { operation, table } = parseQuery(e.query);
    if (MONITORING_TABLES.has(table)) return;
    const route = requestContext.getStore()?.route ?? null;
    const key = `${operation}:${table}:${route ?? "-"}`;
    const ms = Math.round(e.duration);
    void client.slowQueryStat
      .upsert({
        where: { key },
        create: { key, operation, tableName: table, route, totalMs: ms, maxMs: ms, lastMs: ms },
        update: { count: { increment: 1 }, totalMs: { increment: ms }, lastMs: ms, lastSeenAt: new Date() },
      })
      .then(() => client.slowQueryStat.updateMany({ where: { key, maxMs: { lt: ms } }, data: { maxMs: ms } }))
      .catch(() => undefined);
  });
}
