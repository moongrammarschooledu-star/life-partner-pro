import Link from "next/link";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/forgot-password");

// Honest about how access actually works: applicants have no password (a one-time code is e-mailed each time), and a family member's
// password has no self-service reset (known gap, listed in the STEP 35 report). No reset form is offered because none exists.
export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Trouble signing in?</h1>
      <div className="mt-6 space-y-6 text-sm text-muted">
        <section>
          <h2 className="font-medium text-foreground">Applicants</h2>
          <p className="mt-1">
            There is no password to forget. Each time you sign in we e-mail a one-time code to the address on your profile. Enter your Profile ID and that e-mail address on the{" "}
            <Link href="/my-status" className="underline">applicant sign-in</Link>. If the code does not arrive, check your spam folder and that you are using the address you registered with.
          </p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">Family members</h2>
          <p className="mt-1">
            Family accounts do not have a self-service password reset yet. Please <Link href="/contact" className="underline">contact us</Link> from the e-mail address you were invited with, or ask the applicant to contact us, and we will help you regain access.
          </p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">Lost access to your e-mail address?</h2>
          <p className="mt-1">
            Please <Link href="/contact" className="underline">contact us</Link>. A change to the address on a profile is reviewed by our team before it is made.
          </p>
        </section>
      </div>
    </div>
  );
}
