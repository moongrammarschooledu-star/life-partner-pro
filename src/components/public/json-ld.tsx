import { serializeJsonLd } from "@/lib/public-site/structured-data";

// A plain <script> (not next/script): JSON-LD is data, not executable code. The payload is escaped by serializeJsonLd.
export function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
