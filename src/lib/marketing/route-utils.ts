import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";

// Small request helpers shared by the /api/admin/marketing routes.

export async function readBody(req: Request, maxBytes = 100_000): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > maxBytes) throw new HttpError(413, "Request too large.");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

export function str(body: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new HttpError(400, `${key} is required.`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, `${key} must be text.`);
  if (v.length > (opts.max ?? 2000)) throw new HttpError(400, `${key} is too long.`);
  return v;
}

export function int(body: Record<string, unknown>, key: string, required = true): number | undefined {
  const v = body[key];
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${key} is required.`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${key} must be a whole number.`);
  return v;
}

export function dateOrNull(body: Record<string, unknown>, key: string): Date | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${key} is not a valid date.`);
  return d;
}

export function pageParams(url: string): { cursor: string | null; take: number } {
  const q = new URL(url).searchParams;
  const take = Number(q.get("take") ?? 50);
  return { cursor: q.get("cursor"), take: Number.isFinite(take) && take > 0 ? Math.min(Math.floor(take), 100) : 50 };
}

export function dateRange(url: string, defaultDays = 30): { from: Date; to: Date } {
  const q = new URL(url).searchParams;
  const to = q.get("to") ? new Date(q.get("to") as string) : new Date();
  const from = q.get("from") ? new Date(q.get("from") as string) : new Date(to.getTime() - defaultDays * 86_400_000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime()) || from > to) throw new HttpError(400, "Invalid date range.");
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new HttpError(400, "The date range is too long (max 400 days).");
  return { from, to };
}

// handleApiError, plus the policy findings (rule + field + short snippet — never the full text) on a content-policy 422 /
// the governance failures on a launch 422, so the editor can see exactly what to fix.
export function marketingError(error: unknown): NextResponse {
  const e = error as { findings?: unknown; failures?: unknown } | null;
  if (error instanceof HttpError && (Array.isArray(e?.findings) || Array.isArray(e?.failures))) {
    return NextResponse.json({ error: error.message, findings: e?.findings, failures: e?.failures }, { status: error.status });
  }
  return handleApiError(error);
}

export const noStore = { "Cache-Control": "no-store" } as const;
