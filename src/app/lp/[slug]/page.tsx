import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LandingView } from "@/components/marketing/landing-view";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { getPublishedLandingPage } from "@/lib/marketing/landing-service";
import { buildLandingRenderContext } from "@/lib/marketing/landing-render";

// Per-request: the signed touch token and A/B assignment depend on the visit's own URL parameters, so this page is
// never cached or prerendered. In Next 16 `params` and `searchParams` are Promises.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.publicPages))) return { title: "Not found", robots: { index: false, follow: false } };
  const data = await getPublishedLandingPage(slug);
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const { page, version } = data;
  const base = data.canonicalBase;
  const canonical = version.canonicalUrl ?? (base ? `${base}/lp/${page.slug}` : undefined);
  // Only the editor-supplied SEO fields are used — never anything about an applicant.
  return {
    title: version.title,
    description: version.metaDescription ?? undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: page.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { title: version.ogTitle ?? version.title, description: version.ogDescription ?? version.metaDescription ?? undefined, type: "website", images: version.socialImageUrl ? [version.socialImageUrl] : undefined },
  };
}

export default async function LandingPageRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const search = await searchParams;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ctx = await buildLandingRenderContext({ slug, search, referer: h.get("referer"), ip, userAgent: h.get("user-agent") ?? "" });
  if (!ctx) notFound();
  return <LandingView sections={ctx.sections} forms={ctx.forms} touchToken={ctx.touchToken} language={ctx.language} />;
}
