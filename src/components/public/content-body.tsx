import type { ReactNode } from "react";
import Link from "next/link";
import { parseContent, type Inline } from "@/lib/content/markdown";

// Renders the parsed Markdown subset to React elements. No raw-HTML escape hatch is used here: the only way text reaches the page is as a
// React text node, so stored content cannot introduce markup or script.
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return <strong key={i} className="font-semibold text-foreground">{renderInline(n.c)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.c)}</em>;
      case "code":
        return <code key={i} className="rounded bg-surface-muted px-1 py-0.5 text-[0.9em]">{n.v}</code>;
      case "link":
        return n.external ? (
          <a key={i} href={n.href} rel="noopener noreferrer nofollow" target="_blank" className="underline">{renderInline(n.c)}</a>
        ) : (
          <Link key={i} href={n.href} className="underline">{renderInline(n.c)}</Link>
        );
    }
  });
}

export function ContentBody({ body }: { body: string }) {
  const blocks = parseContent(body);
  return (
    <div className="space-y-4 text-base leading-relaxed text-muted">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return <h2 key={i} className="pt-4 font-heading text-2xl font-semibold text-foreground">{renderInline(b.c)}</h2>;
          case "h3":
            return <h3 key={i} className="pt-2 font-heading text-xl font-semibold text-foreground">{renderInline(b.c)}</h3>;
          case "p":
            return <p key={i}>{renderInline(b.c)}</p>;
          case "quote":
            return <blockquote key={i} className="border-l-4 border-border pl-4 italic">{renderInline(b.c)}</blockquote>;
          case "ul":
            return <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
          case "ol":
            return <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
        }
      })}
    </div>
  );
}
