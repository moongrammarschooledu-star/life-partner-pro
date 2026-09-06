"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

// Two-step login (spec §12): precheck verifies the password and, if 2FA is
// required for this admin, sends an OTP without creating a session; only
// after the OTP is verified does the real NextAuth signIn() run. See
// src/app/api/admin/auth/precheck and src/lib/auth.ts's authorize(), which
// independently re-enforces this — calling signIn() directly with just a
// correct password cannot bypass 2FA when it's enabled.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function completeSignIn(otpToken?: string) {
    const res = await signIn("credentials", { email, password, otpToken, redirect: false });
    if (res?.error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }
    router.push(searchParams.get("callbackUrl") ?? "/admin/dashboard");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/auth/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();

    if (json.status === "locked") {
      setError(`Too many failed attempts. Try again in ${json.retryAfterMinutes} minutes.`);
      setLoading(false);
      return;
    }
    if (json.status === "invalid") {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }
    if (json.status === "otp_required") {
      setChallengeId(json.challengeId);
      setLoading(false);
      return;
    }
    await completeSignIn();
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code: otpCode }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Incorrect code.");
      setLoading(false);
      return;
    }
    await completeSignIn(json.otpToken);
  }

  if (challengeId) {
    return (
      <form onSubmit={handleOtpSubmit} className="space-y-4">
        <p className="text-sm text-muted">We emailed a verification code to your admin account. Enter it below to finish signing in.</p>
        <Field label="Verification Code" htmlFor="otp">
          <Input id="otp" inputMode="numeric" required value={otpCode} onChange={(e) => setOtpCode(e.target.value)} autoFocus />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Verify & Sign In
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handlePasswordSubmit} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} Sign In
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <div className="flex flex-col items-center gap-2 mb-6">
            <Image src="/logo-icon.png" alt="Life Partner Pro" width={56} height={56} className="h-14 w-14" priority />
            <h1 className="font-heading text-xl font-semibold">Life Partner Pro</h1>
            <p className="flex items-center gap-1 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5" /> Administrator Login
            </p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-center text-xs text-muted">
            <Link href="/" className="hover:underline">
              &larr; Back to home
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
