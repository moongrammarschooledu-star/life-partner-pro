import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { phoneLoginEnabled } from "@/lib/verification/contact-code";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/register");

// The wizard asks for an e-mail address only until phone sign-in is switched on; the setting is read on every visit, never baked into the built page.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  let emailOptional = false;
  try {
    emailOptional = await phoneLoginEnabled();
  } catch {
    // if the setting cannot be read, behave as before: e-mail required
  }
  return <RegistrationWizard emailOptional={emailOptional} />;
}
