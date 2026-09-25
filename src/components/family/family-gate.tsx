"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// Family-member session gate — mirrors src/components/public/applicant-gate.tsx's
// shape, but for the password-based family session (Decision 2): a login
// form instead of a Profile ID + email lookup.
export function FamilyGate({ children }: { children: ReactNode }) {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/family/dashboard")
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, []);

  async function login() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/family/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!res.ok) {
        show((await res.json()).error ?? "Invalid email or password.", "error");
        return;
      }
      setSignedIn(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn === null) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Family Portal</h1>
        <p className="mt-2 text-sm text-muted">Sign in with the email and password you set when you accepted your invitation.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password" htmlFor="password"><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} /></Field>
            <Button onClick={login} disabled={submitting || !email || !password} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign In
            </Button>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">Don&apos;t have an invitation link? Ask the applicant to invite you from their dashboard.</p>
      </div>
    );
  }

  return <>{children}</>;
}
