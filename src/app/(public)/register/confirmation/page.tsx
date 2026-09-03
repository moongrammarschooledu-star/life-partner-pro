import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export default async function ConfirmationPage({ searchParams }: PageProps<"/register/confirmation">) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : undefined;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center sm:px-6">
      <CheckCircle2 className="h-14 w-14 text-success" />
      <h1 className="font-heading text-2xl font-semibold">Your profile has been submitted</h1>
      {code && (
        <p className="text-sm text-muted">
          Your profile reference: <span className="font-mono font-medium text-foreground">{code}</span>
        </p>
      )}
      <p className="text-muted">
        Thank you for registering with Life Partner Pro. Our team will review your profile and begin the matchmaking
        process. Your information remains private and is only visible to authorized administrators.
      </p>
      <Link href="/" className={buttonClass()}>
        Return Home
      </Link>
    </div>
  );
}
