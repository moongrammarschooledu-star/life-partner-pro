// A deliberately small Markdown subset for blog articles and guides, parsed into plain data and rendered to React elements by our own
// component (never as raw HTML). Content therefore cannot inject script, styles or markup: anything outside the subset is shown as text.
//
// Supported:  ## heading, ### heading, paragraphs, - bullet lists, 1. numbered lists, > quote, **bold**, *italic*, `code`, [text](link)
// Links: relative paths ("/pricing") and https:// addresses only. Everything else (javascript:, data:, http:, mailto:, //host) becomes plain text.

export type Inline = { t: "text"; v: string } | { t: "strong"; c: Inline[] } | { t: "em"; c: Inline[] } | { t: "code"; v: string } | { t: "link"; href: string; external: boolean; c: Inline[] };

export type Block = { t: "h2" | "h3"; c: Inline[] } | { t: "p"; c: Inline[] } | { t: "quote"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (href.length === 0 || href.length > 500 || /[\s<>"'`\\]/.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return { href, external: false };
  if (/^https:\/\/[^/]/i.test(href)) {
    try {
      const u = new URL(href);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      return { href: u.toString(), external: true };
    } catch {
      return null;
    }
  }
  return null;
}

const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "strong", c: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "em", c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: "code", v: m[3] });
    else {
      const link = safeHref(m[5]);
      if (link) out.push({ t: "link", href: link.href, external: link.external, c: parseInline(m[4]) });
      else out.push({ t: "text", v: m[4] });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function parseContent(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ t: heading[1].length === 3 ? "h3" : "h2", c: parseInline(heading[2].trim()) });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list && list.t !== kind) flushList();
      if (!list) list = { t: kind, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      flushList();
      blocks.push({ t: "quote", c: parseInline(quote[1]) });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of a body, for reading time, previews and policy scanning. */
export function plainText(body: string): string {
  return body
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`>#]/g, "")
    .replace(/^\s*[-\d.)]+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function readingMinutes(body: string): number {
  const words = plainText(body).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
