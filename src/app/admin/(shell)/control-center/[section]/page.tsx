import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/page-guard";
import { findSection } from "@/lib/platform/sections";
import { SectionHub } from "@/components/admin/platform/hub-client";

export default async function ControlCenterSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const user = await requirePagePermission("platform:control_center:view");
  const { section: key } = await params;
  const section = findSection(key);
  if (!section) notFound();
  if (section.requires && !user.permissions.includes(section.requires)) redirect("/admin/control-center");
  if (section.page && section.page !== `/admin/control-center/${section.key}`) redirect(section.page);
  return <SectionHub sectionKey={section.key} permissions={user.permissions} />;
}