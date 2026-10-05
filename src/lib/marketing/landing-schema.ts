import { createHash } from "crypto";
import { z } from "zod";
import { HttpError } from "@/lib/http-error";

// STEP 29 §9 — landing page content is a zod-validated list of STRUCTURED sections rendered by React components.
// There is no raw-HTML field anywhere (no sanitiser exists in this app and no unsafe HTML injection is ever used),
// so XSS is closed by construction. All strings are plain text.

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[<>]/.test(v) && !/javascript:/i.test(v) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), "Text must be plain text (no markup or control characters).");

const optionalPlain = (max: number) => plain(max).optional();

// A link is either a same-site relative path or an https URL; the host allow-list is enforced by the content policy.
const href = z
  .string()
  .trim()
  .max(300)
  .refine((v) => (v.startsWith("/") && !v.startsWith("//")) || /^https:\/\//i.test(v), "Links must be a relative path or an https URL.")
  .refine((v) => !/[\s<>"'`]/.test(v) && !/javascript:/i.test(v), "Link contains unsafe characters.");

const idField = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

const item = z.object({ title: plain(80), text: plain(300) });

export const heroSection = z.object({ id: idField, type: z.literal("HERO"), heading: plain(120), subtitle: optionalPlain(240), ctaLabel: optionalPlain(40), ctaHref: href.optional() });
export const textSection = z.object({ id: idField, type: z.literal("TEXT"), heading: plain(120), body: plain(1500) });
export const benefitsSection = z.object({ id: idField, type: z.literal("BENEFITS"), heading: plain(120), items: z.array(item).min(1).max(8) });
export const stepsSection = z.object({ id: idField, type: z.literal("STEPS"), heading: plain(120), items: z.array(item).min(1).max(8) });
export const faqSection = z.object({ id: idField, type: z.literal("FAQ"), heading: plain(120), items: z.array(z.object({ q: plain(160), a: plain(600) })).min(1).max(12) });
// Statements about the verification PROCESS only — no counts, outcomes or testimonials (the content policy enforces this).
export const trustSection = z.object({ id: idField, type: z.literal("PROCESS_TRUST"), heading: plain(120), statements: z.array(plain(240)).min(1).max(6) });
export const ctaSection = z.object({ id: idField, type: z.literal("CTA"), heading: plain(120), body: optionalPlain(300), ctaLabel: plain(40), ctaHref: href });
export const formEmbedSection = z.object({ id: idField, type: z.literal("FORM_EMBED"), heading: optionalPlain(120), formId: z.string().min(1).max(40) });
export const disclaimerSection = z.object({ id: idField, type: z.literal("DISCLAIMER"), body: plain(800) });

export const landingSectionSchema = z.discriminatedUnion("type", [
  heroSection, textSection, benefitsSection, stepsSection, faqSection, trustSection, ctaSection, formEmbedSection, disclaimerSection,
]);

export const landingSectionsSchema = z.array(landingSectionSchema).min(1).max(20);

export type LandingSection = z.infer<typeof landingSectionSchema>;

export const MAX_SECTIONS_BYTES = 60_000;

export function parseLandingSections(input: unknown): LandingSection[] {
  const size = JSON.stringify(input ?? null).length;
  if (size > MAX_SECTIONS_BYTES) throw new HttpError(422, "Landing page content is too large.");
  const parsed = landingSectionsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(422, `Invalid landing page content at ${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  return parsed.data;
}

export function collectLandingTexts(sections: LandingSection[]): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  sections.forEach((s, i) => {
    const base = `sections[${i}](${s.type})`;
    for (const [k, v] of Object.entries(s)) {
      if (k === "id" || k === "type" || k === "formId") continue;
      if (typeof v === "string") out.push({ field: `${base}.${k}`, text: v });
      else if (Array.isArray(v)) {
        v.forEach((e, j) => {
          if (typeof e === "string") out.push({ field: `${base}.${k}[${j}]`, text: e });
          else if (e && typeof e === "object") for (const [ek, ev] of Object.entries(e)) if (typeof ev === "string") out.push({ field: `${base}.${k}[${j}].${ek}`, text: ev });
        });
      }
    }
  });
  return out;
}

export function landingDisclosures(sections: LandingSection[]): { privacyNotice: boolean; consentBlock: boolean; disclaimer: boolean } {
  const hasForm = sections.some((s) => s.type === "FORM_EMBED");
  return {
    // The privacy notice link is rendered by the form itself (the form version pins privacyNoticeVersionId), so a form embed carries both.
    privacyNotice: hasForm,
    consentBlock: hasForm,
    disclaimer: sections.some((s) => s.type === "DISCLAIMER"),
  };
}

export function contentHashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
