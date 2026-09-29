import { HttpError } from "@/lib/http-error";

// Small request-parsing helpers shared by the document routes — mirrors src/lib/communications/route-utils.ts.

export function str(value: unknown, name: string, opts: { max?: number; optional?: boolean } = {}): string {
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(400, `${name} is required.`);
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be text.`);
  if (value.length > (opts.max ?? 5000)) throw new HttpError(400, `${name} is too long.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new HttpError(400, `${name} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function optionalOneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return oneOf(value, allowed, name);
}

export function takeParam(value: string | null, def = 50, max = 200): number {
  const n = Number(value ?? def);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
}

export function dateParam(value: unknown, name: string, optional = true): Date | undefined {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new HttpError(400, `${name} is required.`);
  }
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} is not a valid date.`);
  return d;
}

export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload.");
  }
}

export async function fileFromForm(form: FormData, field = "file"): Promise<{ buffer: Buffer; mimeType: string; filename: string | null }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "A file is required.");
  return { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type || "application/octet-stream", filename: file.name || null };
}
