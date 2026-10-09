// A small in-memory stand-in for the Prisma client, shared by flow tests. It models just what the services use: create / createMany / findFirst /
// findUnique / findMany / count / groupBy / aggregate / update / updateMany / upsert / deleteMany, simple where operators (in, notIn, not, lt, lte,
// gt, gte, OR, AND, compound unique keys), `orderBy`, `take`, `distinct`, nested `create`, and `include` (one-to-many and many-to-one, with
// where / orderBy / take on the include). It is NOT a database: it exists so a test can assert what a service wrote and decided.

export type Row = Record<string, unknown> & { id?: string | number };

export interface FakeDbConfig {
  defaults?: Record<string, Row>;
  unique?: Record<string, string[]>;
  nested?: Record<string, [relation: string, child: string, fk: string]>;
  relations?: Record<string, Record<string, [child: string, key: string, kind: "many" | "one"]>>;
}

const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : typeof v === "bigint" ? Number(v) : (v as number));
const OPS = ["in", "notIn", "not", "lte", "lt", "gte", "gt"];

function cmp(actual: unknown, c: Record<string, unknown>): boolean {
  if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
  if ("notIn" in c && (c.notIn as unknown[]).includes(actual)) return false;
  if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
  if ("lte" in c && !(actual != null && ms(actual) <= ms(c.lte))) return false;
  if ("lt" in c && !(actual != null && ms(actual) < ms(c.lt))) return false;
  if ("gte" in c && !(actual != null && ms(actual) >= ms(c.gte))) return false;
  if ("gt" in c && !(actual != null && ms(actual) > ms(c.gt))) return false;
  return true;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(v as Row[]).every((w) => matches(row, w))) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if (Object.keys(c).some((x) => OPS.includes(x))) { if (!cmp(row[k], c)) return false; continue; }
      if (k.includes("_")) { if (!matches(row, c as Row)) return false; continue; } // compound unique key
      continue; // a relation filter: not modelled
    }
    if (v instanceof Date) { if (!(row[k] instanceof Date) || (row[k] as Date).getTime() !== v.getTime()) return false; continue; }
    if (v === null ? row[k] != null : row[k] !== v) return false;
  }
  return true;
}

function sortRows(list: Row[], orderBy: unknown): void {
  const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (!ob) return;
  const [key, dir] = Object.entries(ob as Row)[0] as [string, string];
  list.sort((a, b) => (ms(a[key]) > ms(b[key]) ? 1 : ms(a[key]) < ms(b[key]) ? -1 : 0) * (dir === "desc" ? -1 : 1));
}

export function createFakeDb(config: FakeDbConfig = {}) {
  const db = new Map<string, Row[]>();
  let idc = 0;
  const rows = (t: string): Row[] => { if (!db.has(t)) db.set(t, []); return db.get(t) as Row[]; };
  const defaults = config.defaults ?? {};
  const unique = config.unique ?? {};
  const nested = config.nested ?? {};
  const relations = config.relations ?? {};

  function withIncludes(t: string, row: Row, include: Record<string, unknown> | undefined): Row {
    if (!include) return row;
    const out: Row = { ...row };
    for (const [name, opt] of Object.entries(include)) {
      const rel = relations[t]?.[name];
      if (!rel) continue;
      const [child, key, kind] = rel;
      if (kind === "one") { out[name] = rows(child).find((r) => r.id === row[key]) ?? null; continue; }
      const o = (opt && typeof opt === "object" ? opt : {}) as { where?: Row; orderBy?: unknown; take?: number };
      let list = rows(child).filter((r) => r[key] === row.id && matches(r, o.where)).map((r) => ({ ...r }));
      sortRows(list, o.orderBy);
      if (o.take) list = list.slice(0, o.take);
      out[name] = list;
    }
    return out;
  }

  function model(t: string) {
    const dup = (row: Row) => unique[t] && rows(t).some((r) => unique[t].every((k) => String(r[k]) === String(row[k])));
    const create = async ({ data }: { data: Row }): Promise<Row> => {
      const n = nested[t];
      const { [n?.[0] ?? "__none"]: nestedData, ...rest } = data;
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + idc), startedAt: new Date(Date.now() + idc), updatedAt: new Date(Date.now() + idc), ...defaults[t], ...rest };
      if (dup(row)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows(t).push(row);
      if (n && nestedData && (nestedData as { create?: Row | Row[] }).create) {
        const c = (nestedData as { create: Row | Row[] }).create;
        for (const item of Array.isArray(c) ? c : [c]) await model(n[1]).create({ data: { ...item, [n[2]]: row.id } });
      }
      return { ...row };
    };
    return {
      create,
      createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of data) {
          try { await create({ data: d }); count++; } catch (e) { if (!skipDuplicates) throw e; }
        }
        return { count };
      },
      findFirst: async ({ where, include, orderBy }: { where?: Row; include?: Row; orderBy?: unknown } = {}) => {
        const list = rows(t).filter((x) => matches(x, where));
        sortRows(list, orderBy);
        return list[0] ? withIncludes(t, { ...list[0] }, include) : null;
      },
      findUnique: async ({ where, include }: { where: Row; include?: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? withIncludes(t, { ...r }, include) : null; },
      findUniqueOrThrow: async ({ where, include }: { where: Row; include?: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); return withIncludes(t, { ...r }, include); },
      findMany: async ({ where, take, distinct, orderBy, include }: { where?: Row; take?: number; distinct?: string[]; orderBy?: unknown; include?: Row } = {}) => {
        let out = rows(t).filter((x) => matches(x, where)).map((r) => withIncludes(t, { ...r }, include));
        if (distinct) { const seen = new Set<string>(); out = out.filter((r) => { const k = distinct.map((d) => String(r[d])).join("|"); if (seen.has(k)) return false; seen.add(k); return true; }); }
        sortRows(out, orderBy);
        return take ? out.slice(0, take) : out;
      },
      count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
      groupBy: async ({ by, where, _count, _sum }: { by: string[]; where?: Row; _count?: unknown; _sum?: Record<string, boolean> }) => {
        const groups = new Map<string, Row[]>();
        for (const r of rows(t).filter((x) => matches(x, where))) {
          const k = by.map((b) => String(r[b])).join("|");
          groups.set(k, [...(groups.get(k) ?? []), r]);
        }
        return [...groups.values()].map((g) => {
          const out: Row = {};
          for (const b of by) out[b] = g[0][b];
          if (_count) out._count = { _all: g.length };
          if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map((f) => [f, g.reduce((n, r) => n + (Number(r[f]) || 0), 0)]));
          return out;
        });
      },
      aggregate: async ({ where, _sum }: { where?: Row; _sum?: Record<string, boolean> }) => ({ _sum: Object.fromEntries(Object.keys(_sum ?? {}).map((f) => [f, rows(t).filter((x) => matches(x, where)).reduce((n, r) => n + (Number(r[f]) || 0), 0)])) }),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = rows(t).find((x) => matches(x, where));
        if (!r) throw new Error(`not found: ${t}`);
        applyData(r, data);
        r.updatedAt = new Date(Date.now() + ++idc);
        return { ...r };
      },
      updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const m = rows(t).filter((x) => matches(x, where)); m.forEach((r) => applyData(r, data)); return { count: m.length }; },
      upsert: async ({ where, update, create: c }: { where: Row; update: Row; create: Row }) => {
        const r = rows(t).find((x) => matches(x, where));
        if (r) { applyData(r, update); return { ...r }; }
        return create({ data: { ...c } });
      },
      deleteMany: async ({ where }: { where?: Row }) => { const keep = rows(t).filter((x) => !matches(x, where)); const n = rows(t).length - keep.length; db.set(t, keep); return { count: n }; },
    };
  }

  function applyData(r: Row, data: Row): void {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("increment" in (v as Row))) { r[k] = (Number(r[k]) || 0) + Number((v as { increment: number }).increment); continue; }
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && "create" in (v as Row) && nested[Object.keys(nested).find((nt) => nested[nt][0] === k) ?? ""]) continue; // nested create on update: not modelled
      r[k] = v;
    }
  }

  const proxy = new Proxy({}, {
    get: (_t, name: string) => {
      if (name === "$transaction") return async (ops: Promise<unknown>[]) => Promise.all(ops);
      if (name === "$queryRaw") return async () => [];
      return model(name);
    },
  });

  return { rows, db, prisma: proxy, reset: () => { db.clear(); idc = 0; } };
}
