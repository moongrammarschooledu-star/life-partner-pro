import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/register");

export default function RegisterPage() {
  return <RegistrationWizard />;
}
