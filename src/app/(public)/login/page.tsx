import Link from "next/link";
import { UserRound, Users } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/login");

// There is one sign-in per kind of user, each with its own session, so this page only points to the right one. It does not collect any
// credential itself and does not duplicate the authentication logic.
export default function LoginPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-muted">Choose how you use Life Partner Pro.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex h-full flex-col gap-3">
            <UserRound className="h-7 w-7 text-primary" aria-hidden="true" />
            <h2 className="font-medium">I am an applicant</h2>
            <p className="flex-1 text-sm text-muted">Sign in with your Profile ID and e-mail address. We send a one-time code to that address.</p>
            <Link href="/my-status" className={buttonClass({})}>Applicant sign-in</Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex h-full flex-col gap-3">
            <Users className="h-7 w-7 text-primary" aria-hidden="true" />
            <h2 className="font-medium">I am a family member</h2>
            <p className="flex-1 text-sm text-muted">Sign in with the e-mail and password you set when you accepted the applicant&apos;s invitation.</p>
            <Link href="/family/dashboard" className={buttonClass({ variant: "outline" })}>Family sign-in</Link>
          </CardContent>
        </Card>
      </div>
      <p className="mt-8 text-sm text-muted">
        New here? <Link href="/register" className="underline">Create your profile</Link>. Having trouble? <Link href="/forgot-password" className="underline">Get help signing in</Link>.
      </p>
    </div>
  );
}
