import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentArticlePage } from "@/components/public/content-pages";
import { getLivePost, publicPath } from "@/lib/content/service";
import { contentMetadata } from "@/lib/public-site/seo";

// Regenerated at most every five minutes, so an archived guide leaves the site within that time.
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getLivePost("GUIDE", slug);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };
  return contentMetadata({
    path: publicPath("GUIDE", slug),
    title: post.seoTitle || `${post.title} | Life Partner Pro`,
    description: post.seoDescription || post.summary,
    indexable: !post.noindex,
    type: "article",
    publishedTime: (post.publishedAt ?? post.scheduledFor ?? post.createdAt).toISOString(),
    modifiedTime: post.updatedAt.toISOString(),
  });
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const page = await ContentArticlePage({ type: "GUIDE", slug });
  if (!page) notFound();
  return page;
}
