import { safeConfigValue } from "@/lib/platform/config-values";

// Safe comparison of two configuration values (STEP 36 §51). Both sides go through safeConfigValue, so a secret-looking key or value is shown as "[hidden]"
// on both sides and counts as "unchanged" rather than leaking that it differs.

export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  change: "added" | "removed" | "changed";
}

const MAX_ENTRIES = 200;

function walk(path: string, a: unknown, b: unknown, out: DiffEntry[]) {
  if (out.length >= MAX_ENTRIES) return;
  const bothObjects = a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b);
  if (bothObjects) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of [...keys].sort()) walk(path ? `${path}.${k}` : k, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out);
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  out.push({ path: path || "(value)", before: a, after: b, change: a === undefined ? "added" : b === undefined ? "removed" : "changed" });
}

export function diffConfig(key: string, before: unknown, after: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk("", safeConfigValue(key, before), safeConfigValue(key, after), out);
  return out;
}
