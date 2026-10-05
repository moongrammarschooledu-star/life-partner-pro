"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

// Admin password reset by e-mailed code (see src/lib/admin-password-reset.ts). Step 1 asks for the e-mail and always shows
// the same confirmation; step 2 takes the code and the new password. Signing in afterwards still goes through the normal
// login flow, including the login code when 2FA is on.
export default function AdminForgotPasswordPage() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not send the code. Please try again shortly.");
      } else {
        setNotice(json.message ?? "If an admin account exists for that e-mail, a reset code has been sent.");
        setStep("code");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, newPassword }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(json.error ?? "Could not reset the password.");
      else setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <div className="mb-6 flex flex-col items-center gap-2">
            <Image src="/logo-icon.png" alt="Life Partner Pro" width={56} height={56} className="h-14 w-14" priority />
            <h1 className="font-heading text-xl font-semibold">Reset admin password</h1>
            <p className="flex items-center gap-1 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5" /> Administrator account
            </p>
          </div>

          {step === "email" && (
            <form onSubmit={requestCode} className="space-y-4">
              <p className="text-sm text-muted">Enter your admin e-mail. If it belongs to an admin account, we will e-mail you a 6-digit code.</p>
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
              </Field>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Send reset code
              </Button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={submitReset} className="space-y-4">
              {notice && <p className="text-sm text-muted">{notice}</p>}
              <Field label="6-digit code" htmlFor="code">
                <Input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" autoFocus />
              </Field>
              <Field label="New password" htmlFor="newPassword">
                <Input id="newPassword" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm">
                <Input id="confirm" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </Field>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Reset password
              </Button>
              <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={() => { setStep("email"); setError(null); setCode(""); }}>
                Send a new code
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <p className="text-sm">Your password has been changed and all earlier sessions were signed out.</p>
              <Link href="/admin/login" className="inline-block text-sm font-medium text-primary hover:underline">
                Go to sign in
              </Link>
            </div>
          )}

          {step !== "done" && (
            <p className="mt-6 text-center text-xs text-muted">
              <Link href="/admin/login" className="hover:underline">
                &larr; Back to sign in
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
