import { requirePagePermission } from "@/lib/page-guard";
import { SettingsClient } from "@/components/admin/platform/settings-client";

export default async function LocalizationPage() {
  const user = await requirePagePermission("platform:settings:view");
  return <SettingsClient permissions={user.permissions} categories={["localization"]} title="Language, country and time" description="Default language and country, currency display, time zone and date/time format. Translations themselves are not edited here: English and Urdu text lives in the application." />;
}