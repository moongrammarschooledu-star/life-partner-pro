import { requirePagePermission } from "@/lib/page-guard";
import { SettingsClient } from "@/components/admin/platform/settings-client";

export default async function BrandingPage() {
  const user = await requirePagePermission("platform:branding:view");
  return <SettingsClient permissions={user.permissions} categories={["branding", "contact"]} title="Branding and public contact" description="Brand colour, e-mail footer, website address and the contact details shown to the public. Logo and image upload is not provided here." />;
}