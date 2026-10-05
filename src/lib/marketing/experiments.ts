import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { marketingAudit } from "@/lib/marketing/audit";
import { scanMarketingContent } from "@/lib/marketing/content-policy";
import { allowedMarketingHosts } from "@/lib/marketing/hosts";
import type { SessionAdmin } from "@/lib/route-guard";
import type { MarketingEventType, MarketingExperiment } from "@prisma/client";

// STEP 29 §28 — A/B testing. Assignment is deterministic by hash (no cookies, no stored visitor ids), outcomes are
// counted from MarketingEvent.variantKey, and the report NEVER declares a winner on thin data or promotes a variant
// automatically: below the minimum sample per variant it says "INSUFFICIENT_DATA".

const plainText = (max: number) => z.string().trim().min(1).max(max).refine((v) => !/[<>]/.test(v), "Plain text only.");
// A variant may override ONLY the hero headline/subtitle and the call-to-action label (plain text, content-policy scanned).
const overridesSchema = z.object({ heroHeading: plainText(120).optional(), heroSubtitle: plainText(240).optional(), ctaLabel: plainText(40).optional() }).strict();
const variantSchema = z.object({ key: z.string().regex(/^[a-z0-9_]{1,20}$/), label: z.string().trim().min(1).max(60), trafficPct: z.number().int().min(1).max(99), overrides: overridesSchema.optional() });
const variantsSchema = z.array(variantSchema).min(2).max(5).superRefine((vs, ctx) => {
  if (vs.reduce((n, v) => n + v.trafficPct, 0) !== 100) ctx.addIssue({ code: "custom", message: "Traffic allocation must add up to 100%." });
  if (new Set(vs.map((v) => v.key)).size !== vs.length) ctx.addIssue({ code: "custom", message: "Variant keys must be unique." });
});
export type ExperimentVariant = z.infer<typeof variantSchema>;

export function parseExperimentVariants(value: unknown): ExperimentVariant[] {
  return variantsSchema.parse(value);
}

// Only events that carry the variant key (landing views, CTA clicks, form starts from the page; leads via the touch token).
const METRICS: MarketingEventType[] = ["FORM_STARTED", "LEAD_CREATED", "CTA_CLICK"];

export function assignVariant(experimentId: string, variants: ExperimentVariant[], subject: string): string {
  const bucket = parseInt(createHash("sha256").update(`${experimentId}:${subject}`).digest("hex").slice(0, 8), 16) % 100;
  let acc = 0;
  for (const v of variants) {
    acc += v.trafficPct;
    if (bucket < acc) return v.key;
  }
  return variants[variants.length - 1].key;
}

// Normal CDF via the Abramowitz–Stegun approximation (no stats dependency needed).
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export interface TwoProportionResult {
  z: number;
  pValue: number;
}

export function twoProportionTest(conv1: number, n1: number, conv2: number, n2: number): TwoProportionResult | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = conv1 / n1;
  const p2 = conv2 / n2;
  const pooled = (conv1 + conv2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1 };
  const z = (p2 - p1) / se;
  return { z, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
}

export interface VariantResult {
  key: string;
  label: string;
  exposures: number;
  conversions: number;
  ratePct: number | null;
}

export type ExperimentVerdict =
  | { status: "INSUFFICIENT_DATA"; message: string }
  | { status: "NO_SIGNIFICANT_DIFFERENCE"; message: string }
  | { status: "SIGNIFICANT_DIFFERENCE"; leader: string; message: string };

export function evaluateExperiment(variants: Array<{ key: string; label: string; exposures: number; conversions: number }>, minSampleSize: number): { results: VariantResult[]; verdict: ExperimentVerdict } {
  const results: VariantResult[] = variants.map((v) => ({ ...v, ratePct: v.exposures >= minSampleSize ? Math.round((v.conversions / v.exposures) * 1000) / 10 : null }));
  if (results.some((r) => r.exposures < minSampleSize)) return { results, verdict: { status: "INSUFFICIENT_DATA", message: `Insufficient data: every variant needs at least ${minSampleSize} visitors.` } };
  const control = results[0];
  let best: { key: string; label: string; p: number; rate: number } | null = null;
  for (const r of results.slice(1)) {
    const t = twoProportionTest(control.conversions, control.exposures, r.conversions, r.exposures);
    if (t && t.pValue < 0.05) {
      const rate = r.conversions / r.exposures;
      const controlRate = control.conversions / control.exposures;
      const leader = rate > controlRate ? r : control;
      if (!best || t.pValue < best.p) best = { key: leader.key, label: leader.label, p: t.pValue, rate };
    }
  }
  return best
    ? { results, verdict: { status: "SIGNIFICANT_DIFFERENCE", leader: best.key, message: `A statistically significant difference was detected (p < 0.05). "${best.label}" is ahead. This is information for a human decision — nothing is changed automatically.` } }
    : { results, verdict: { status: "NO_SIGNIFICANT_DIFFERENCE", message: "No statistically significant difference at the current sample size." } };
}

export async function createExperiment(actor: SessionAdmin, input: { name: string; campaignId?: string | null; landingPageId?: string | null; variants: unknown; primaryMetric?: string; minSampleSize?: number }): Promise<MarketingExperiment> {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120 || /[<>]/.test(name)) throw new HttpError(422, "A valid name is required.");
  const parsed = variantsSchema.safeParse(input.variants);
  if (!parsed.success) throw new HttpError(422, `Invalid variants: ${parsed.error.issues[0].message}`);
  // Override copy is marketing content like any other: it must pass the content policy before a variant can exist.
  const overrideTexts = parsed.data.flatMap((v) => Object.entries(v.overrides ?? {}).map(([field, text]) => ({ field: `${v.key}.${field}`, text: String(text) })));
  if (overrideTexts.length) {
    const scan = scanMarketingContent({ texts: overrideTexts, allowedUrlHosts: allowedMarketingHosts() });
    if (!scan.pass) throw Object.assign(new HttpError(422, "A variant's wording conflicts with the marketing content policy."), { findings: scan.findings });
  }
  const metric = (input.primaryMetric ?? "LEAD_CREATED") as MarketingEventType;
  if (!METRICS.includes(metric)) throw new HttpError(422, "Unsupported primary metric.");
  const min = input.minSampleSize ?? 100;
  if (!Number.isInteger(min) || min < 30 || min > 100000) throw new HttpError(422, "Minimum sample size must be between 30 and 100000.");
  const exp = await prisma.marketingExperiment.create({ data: { name, campaignId: input.campaignId ?? null, landingPageId: input.landingPageId ?? null, variants: parsed.data as never, primaryMetric: metric, minSampleSize: min, createdById: actor.id } });
  await marketingAudit({ action: "MARKETING_EXPERIMENT_CHANGED", actorId: actor.id, resource: "experiment", resourceId: exp.id, after: { status: "DRAFT", variants: parsed.data.length } });
  return exp;
}

export async function setExperimentStatus(actor: SessionAdmin, id: string, to: "RUNNING" | "STOPPED" | "ARCHIVED"): Promise<MarketingExperiment> {
  const exp = await prisma.marketingExperiment.findUnique({ where: { id } });
  if (!exp) throw new HttpError(404, "Experiment not found.");
  const allowed: Record<string, string[]> = { DRAFT: ["RUNNING", "ARCHIVED"], RUNNING: ["STOPPED"], STOPPED: ["ARCHIVED"], ARCHIVED: [] };
  if (!allowed[exp.status].includes(to)) throw new HttpError(409, `A ${exp.status.toLowerCase()} experiment cannot become ${to.toLowerCase()}.`);
  const updated = await prisma.marketingExperiment.update({ where: { id }, data: { status: to, ...(to === "RUNNING" ? { startedAt: new Date() } : {}), ...(to === "STOPPED" ? { stoppedAt: new Date() } : {}) } });
  await marketingAudit({ action: "MARKETING_EXPERIMENT_CHANGED", actorId: actor.id, resource: "experiment", resourceId: id, before: { status: exp.status }, after: { status: to } });
  return updated;
}

export async function getExperimentReport(id: string) {
  const exp = await prisma.marketingExperiment.findUnique({ where: { id } });
  if (!exp) throw new HttpError(404, "Experiment not found.");
  const variants = variantsSchema.parse(exp.variants);
  const since = exp.startedAt ?? exp.createdAt;
  const until = exp.stoppedAt ?? new Date();
  const counts = await Promise.all(
    variants.map(async (v) => {
      const base = { variantKey: v.key, ...(exp.campaignId ? { campaignId: exp.campaignId } : {}), ...(exp.landingPageId ? { landingPageId: exp.landingPageId } : {}), occurredAt: { gte: since, lte: until } };
      const [exposures, conversions] = await Promise.all([
        prisma.marketingEvent.count({ where: { ...base, type: "LANDING_PAGE_VIEW" } }),
        prisma.marketingEvent.count({ where: { ...base, type: exp.primaryMetric as MarketingEventType } }),
      ]);
      return { key: v.key, label: v.label, exposures, conversions };
    }),
  );
  return { experiment: exp, ...evaluateExperiment(counts, exp.minSampleSize) };
}
