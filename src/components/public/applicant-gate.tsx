"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// STEP 21 — shared "Profile ID + registered email to continue" gate, factored
// out of the boilerplate every /my-* page has re-implemented individually
// since STEP 1. Used by the new /dashboard/* route group's layout so the
// sign-in form appears once per visit rather than once per page. Existing
// /my-* pages keep their own inline copy unchanged (zero regression risk).
export function ApplicantGate({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    fetch("/api/my-status")
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, []);

  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      setSignedIn(true);
    } finally {
      setLookingUp(false);
    }
  }

  if (signedIn === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
