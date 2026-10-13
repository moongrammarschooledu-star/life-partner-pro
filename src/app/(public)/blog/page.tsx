import type { Metadata } from "next";
import { ContentIndexPage, isFilteredView, type IndexSearch } from "@/components/public/content-pages";
import { pageMetadata } from "@/lib/public-site/seo";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<IndexSearch> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const base = pageMetadata("/blog");
  return isFilteredView(await searchParams) ? { ...base, robots: { index: false, follow: true } } : base;
}

export default async function BlogPage({ searchParams }: Props) {
  return <ContentIndexPage type="ARTICLE" search={await searchParams} />;
}
