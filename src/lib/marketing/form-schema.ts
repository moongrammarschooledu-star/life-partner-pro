import { z } from "zod";
import { HttpError } from "@/lib/http-error";
import { normalizeEmail, normalizePhoneE164 } from "@/lib/marketing/normalize";

// STEP 29 §12/§13 — configurable lead forms. Field KEYS come from a closed allow-list: sensitive matrimonial and
// identity attributes (religion, sect, caste, income, DOB, CNIC/passport, photos, height, health…) cannot be added to a
// marketing form at all, and the consent block must be explicit and unticked by default.

export const FORM_FIELD_KEYS = [
  "fullName", "phone", "email", "whatsapp", "city", "area", "preferredChannel", "preferredContactTime",
  "inquiry", "relationshipToApplicant", "referralCode",
] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

const FORBIDDEN_KEY_FRAGMENTS = /(religion|sect|caste|zaat|ethnic|income|salary|dob|birth|cnic|passport|national_?id|photo|image|complexion|height|health|disab|marital|divorc)/i;

const fieldDef = z.object({
  key: z.enum(FORM_FIELD_KEYS),
  label: z.string().trim().min(1).max(80).refine((v) => !/[<>]/.test(v), "Labels are plain text."),
  required: z.boolean().default(false),
  maxLen: z.number().int().min(1).max(500).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

export const formFieldsSchema = z
  .array(fieldDef)
  .min(2)
  .max(12)
  .superRefine((fields, ctx) => {
    const keys = fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate field key." });
    if (!fields.some((f) => f.key === "fullName" && f.required)) ctx.addIssue({ code: "custom", message: "fullName is required on every form." });
    if (!keys.includes("phone") && !keys.includes("email") && !keys.includes("whatsapp")) ctx.addIssue({ code: "custom", message: "A form needs at least one way to reach the person (phone, email or WhatsApp)." });
    for (const f of fields) if (FORBIDDEN_KEY_FRAGMENTS.test(f.key) || FORBIDDEN_KEY_FRAGMENTS.test(f.label)) ctx.addIssue({ code: "custom", message: `Field "${f.label}" asks for information that must not be collected through marketing forms.` });
  });

export type FormFieldDef = z.infer<typeof fieldDef>;

const consentText = z.string().trim().min(10).max(600).refine((v) => !/[<>]/.test(v), "Consent text is plain text.");

export const consentConfigSchema = z.object({
  inquiryContact: z.object({ required: z.literal(true), text: consentText }),
  marketingUpdates: z.object({ enabled: z.boolean(), text: consentText.optional(), defaultChecked: z.literal(false).default(false) }).default({ enabled: false, defaultChecked: false }),
  whatsapp: z.object({ enabled: z.boolean(), text: consentText.optional(), defaultChecked: z.literal(false).default(false) }).default({ enabled: false, defaultChecked: false }),
  privacyNoticeLinkRequired: z.literal(true).default(true),
}).superRefine((c, ctx) => {
  if (c.marketingUpdates.enabled && !c.marketingUpdates.text) ctx.addIssue({ code: "custom", message: "Marketing consent needs its own wording." });
  if (c.whatsapp.enabled && !c.whatsapp.text) ctx.addIssue({ code: "custom", message: "WhatsApp consent needs its own wording." });
});

export type ConsentConfig = z.infer<typeof consentConfigSchema>;

export function parseFormDefinition(fields: unknown, consentConfig: unknown): { fields: FormFieldDef[]; consentConfig: ConsentConfig } {
  const f = formFieldsSchema.safeParse(fields);
  if (!f.success) throw new HttpError(422, `Invalid form fields: ${f.error.issues[0].message}`);
  const c = consentConfigSchema.safeParse(consentConfig);
  if (!c.success) throw new HttpError(422, `Invalid consent configuration: ${c.error.issues[0].message}`);
  return { fields: f.data, consentConfig: c.data };
}

const CHANNELS = ["PHONE", "WHATSAPP", "EMAIL", "SMS"] as const;

export interface SubmittedLead {
  fullName: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  city?: string;
  area?: string;
  preferredChannel?: (typeof CHANNELS)[number];
  preferredContactTime?: string;
  inquiry?: string;
  relationshipToApplicant?: string;
  referralCode?: string;
}

// Validates a public submission against the PINNED form version: unknown keys are dropped (mass-assignment safe),
// every value is length-capped plain text, and required fields must be present.
export function validateSubmission(fields: FormFieldDef[], raw: Record<string, unknown>): { ok: true; value: SubmittedLead } | { ok: false; reason: string } {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.key];
    const text = typeof v === "string" ? v.trim() : "";
    const max = f.maxLen ?? (f.key === "inquiry" ? 500 : f.key === "fullName" ? 120 : 160);
    if (!text) {
      if (f.required) return { ok: false, reason: `${f.key} is required` };
      continue;
    }
    if (text.length > max) return { ok: false, reason: `${f.key} is too long` };
    if (/[<>]/.test(text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return { ok: false, reason: `${f.key} contains invalid characters` };
    if (f.key === "email" && !normalizeEmail(text)) return { ok: false, reason: "email is invalid" };
    if ((f.key === "phone" || f.key === "whatsapp") && !normalizePhoneE164(text)) return { ok: false, reason: `${f.key} is invalid` };
    if (f.key === "preferredChannel" && !CHANNELS.includes(text as (typeof CHANNELS)[number])) return { ok: false, reason: "preferredChannel is invalid" };
    if (f.options && f.options.length && f.key !== "preferredChannel" && !f.options.includes(text)) return { ok: false, reason: `${f.key} is not an allowed option` };
    out[f.key] = text;
  }
  if (!out.fullName) return { ok: false, reason: "fullName is required" };
  if (!out.phone && !out.email && !out.whatsapp) return { ok: false, reason: "a contact method is required" };
  return { ok: true, value: out as unknown as SubmittedLead };
}
