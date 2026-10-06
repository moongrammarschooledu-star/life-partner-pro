import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/page-guard";
import { SectionClient } from "@/components/admin/analytics/screens-a";
import { SECTION_TITLES } from "@/lib/analytics/dashboard-service";
import { SECTIONS, type SectionKey } from "@/lib/analytics/types";

// One page for every section dashboard; the API decides which figures the viewer may see.
export default async function AnalyticsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  await requirePagePermission("analytics:view");
  const { section } = await params;
  if (!(SECTIONS as readonly string[]).includes(section) || section === "executive") notFound();
  return <SectionClient section={section} title={SECTION_TITLES[section as SectionKey]} />;
}
