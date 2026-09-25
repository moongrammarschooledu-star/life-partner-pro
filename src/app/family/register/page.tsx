"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show } = useToast();
  const invitationCode = searchParams.get("code") ?? "";
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (password !== confirmPassword) {
      show("Passwords do not match.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/family/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationCode, token, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not accept the invitation.", "error");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/family/dashboard"), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  if (!invitationCode || !token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center sm:px-6">
        <p className="text-sm text-muted">This invitation link is missing required information. Please use the exact link from your invitation email.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
        <CheckCircle2 className="h-12 w-12 text-success" />
        <h1 className="font-heading text-2xl font-semibold">Welcome to Life Partner Pro</h1>
        <p className="text-sm text-muted">Redirecting you to your dashboard…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold">Accept Your Invitation</h1>
      <p className="mt-2 text-sm text-muted">
        Set a password to activate your family account. You will only see information the applicant explicitly shares
        with you — this is not a public dating platform.
      </p>
      <Card className="mt-6">
        <CardContent className="space-y-4">
          <Field label="Password" htmlFor="password"><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm Password" htmlFor="confirmPassword"><Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
          <Button onClick={submit} disabled={submitting || !password || !confirmPassword} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Activate My Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FamilyRegisterPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
