import { HttpError } from "@/lib/http-error";

// Small request-parsing helpers shared by the communication routes. Every value is validated here or in the service; nothing from a
// request is trusted to name a database column, a destination address or a secret.

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as T;
  } catch {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
}

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

export function dateParam(value: string | null, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} is not a valid date.`);
  return d;
}

export const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
export const EXTERNAL = ["EMAIL", "SMS", "WHATSAPP"] as const;
export const MESSAGE_TYPES = ["TRANSACTIONAL", "SECURITY", "VERIFICATION", "PROPOSAL", "MATCHING", "MEETING", "SUPPORT", "FAMILY", "PAYMENT", "PRIVACY", "SYSTEM", "MARKETING", "ADMIN_INTERNAL"] as const;
export const PURPOSES = ["ACCOUNT", "OTP", "VERIFICATION", "PROFILE", "MATCH", "PROPOSAL", "CONTACT_PERMISSION", "MEETING", "FOLLOWUP", "SUPPORT", "PAYMENT", "PRIVACY", "SECURITY", "FAMILY_ACCESS", "MARKETING", "ADMIN_INTERNAL"] as const;
export const LOCALES = ["EN", "UR"] as const;
