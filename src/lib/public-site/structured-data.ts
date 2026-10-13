import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/public-site/config";

// schema.org JSON-LD builders. Deliberately small: no ratings, no reviews, no aggregate ratings, no invented contact points,
// no social profiles that do not exist, no internal search action. Everything here is a fact the site already states.

type Json = Record<string, unknown>;

export function organizationLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icons/icon-512.png"),
    description: SITE_DESCRIPTION,
  };
}

export function websiteLd(): Json {
  return { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/"), description: SITE_DESCRIPTION, inLanguage: "en" };
}

export function webPageLd(params: { path: string; name: string; description: string }): Json {
  return { "@context": "https://schema.org", "@type": "WebPage", name: params.name, description: params.description, url: absoluteUrl(params.path), isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") } };
}

export function breadcrumbLd(items: Array<{ name: string; path: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: absoluteUrl(item.path) })),
  };
}

/** FAQPage markup must match the visible questions and answers exactly, so the page passes its own list in. */
export function faqLd(items: Array<{ question: string; answer: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
  };
}

export function articleLd(params: { path: string; headline: string; description: string; datePublished: string; dateModified?: string; authorName: string }): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: params.headline,
    description: params.description,
    mainEntityOfPage: absoluteUrl(params.path),
    datePublished: params.datePublished,
    dateModified: params.dateModified ?? params.datePublished,
    author: { "@type": "Person", name: params.authorName },
    publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: absoluteUrl("/icons/icon-512.png") } },
  };
}

/** `<` is escaped so that no string in the data (an article title, for example) can close the script tag. */
export function serializeJsonLd(data: Json | Json[]): string {
  // The two Unicode line separators are built from their code points: written literally they would end a line inside a JS string.
  const lineSep = String.fromCharCode(0x2028);
  const paraSep = String.fromCharCode(0x2029);
  return JSON.stringify(data).replace(/</g, "\\u003c").split(lineSep).join("\\u2028").split(paraSep).join("\\u2029");
}