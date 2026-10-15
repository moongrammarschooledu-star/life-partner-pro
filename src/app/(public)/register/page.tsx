import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { emailOptionalAtRegistration } from "@/lib/verification/contact-code";
import { getSettingValues } from "@/lib/platform/settings";
import { whatsappChatUrl } from "@/lib/whatsapp-link";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/register");

// Whether an e-mail address is asked for, and the "register on WhatsApp" help link, come from settings that can change at any time: read on every visit, never
// baked into the built page.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  let emailOptional = false;
  let helpWhatsappUrl: string | null = null;
  try {
    emailOptional = await emailOptionalAtRegistration();
  } catch {
    // if the setting cannot be read, behave as before: e-mail required
  }
  try {
    // The public WhatsApp number from Control Center > Branding; nothing is shown until an administrator has entered one.
    const settings = await getSettingValues();
    const number = typeof settings["contact.public_whatsapp"] === "string" ? (settings["contact.public_whatsapp"] as string) : "";
    helpWhatsappUrl = whatsappChatUrl(number, "Assalam-o-Alaikum, I would like to register on Life Partner Pro. Please help me create my profile.");
  } catch {
    // no help link
  }
  return <RegistrationWizard emailOptional={emailOptional} helpWhatsappUrl={helpWhatsappUrl} />;
}
