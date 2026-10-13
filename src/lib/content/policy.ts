import { allowedMarketingHosts } from "@/lib/marketing/hosts";
import { scanMarketingContent, type PolicyScanResult } from "@/lib/marketing/content-policy";

// Reuses the STEP 29 content policy (guaranteed-outcome claims, "100%", invented statistics, privacy over-claims, verification over-claims,
// links to other sites) as a gate before anything is published or scheduled. It is a lexical safeguard, not a legal review; a BLOCK finding
// stops publication, a WARN is shown to the person publishing.
export function scanPostContent(post: { title: string; summary: string; body: string; seoTitle?: string | null; seoDescription?: string | null }): PolicyScanResult {
  return scanMarketingContent({
    texts: [
      { field: "title", text: post.title },
      { field: "summary", text: post.summary },
      { field: "body", text: post.body },
      ...(post.seoTitle ? [{ field: "seoTitle", text: post.seoTitle }] : []),
      ...(post.seoDescription ? [{ field: "seoDescription", text: post.seoDescription }] : []),
    ],
    allowedUrlHosts: allowedMarketingHosts(),
  });
}
