"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface LookupResult {
  contact: { mobileNumber: string; whatsappNumber: string | null; email: string };
  preference: { additionalExpectations: string | null } | null;
}

export default function UpdateRequestPage() {
  const { show } = useToast();
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [mobileNumber, setMobileNumber] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [additionalExpectations, setAdditionalExpectations] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // If this browser already holds a valid session cookie from a recent
  // registration (see /my-status), skip straight past the Profile ID +
  // email form — the server resolves identity from the cookie instead.
  useEffect(() => {
    fetch("/api/update-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lookup" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setResult(json);
          setMobileNumber(json.contact.mobileNumber);
          setWhatsappNumber(json.contact.whatsappNumber ?? "");
          setAdditionalExpectations(json.preference?.additionalExpectations ?? "");
        }
      })
      .finally(() => setCheckingSession(false));
  }, []);

  async function lookup() {
    setLoading(true);
    try {
      const res = await fetch("/api/update-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email, action: "lookup" }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      setResult(json);
      setMobileNumber(json.contact.mobileNumber);
      setWhatsappNumber(json.contact.whatsappNumber ?? "");
      setAdditionalExpectations(json.preference?.additionalExpectations ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch("/api/update-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileCode,
          email,
          action: "submit",
          contact: { mobileNumber, whatsappNumber: whatsappNumber || null },
          preference: { additionalExpectations },
        }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      show("Could not submit your update request. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-24 text-center sm:px-6">
        <CheckCircle2 className="h-12 w-12 text-success" />
        <h1 className="font-heading text-2xl font-semibold">Update request submitted</h1>
        <p className="text-muted">An administrator will review your requested changes before they go live on your profile.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold">Request a Profile Update</h1>
      <p className="mt-2 text-sm text-muted">
        Enter your Profile ID (e.g. LPP-000123) and the email you registered with. Changes to sensitive information
        are reviewed by an administrator before they take effect.
      </p>

      <Card className="mt-6">
        <CardContent className="space-y-4">
          <Field label="Profile ID" htmlFor="profileCode">
            <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" disabled={!!result} />
          </Field>
          <Field label="Registered Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!result} />
          </Field>

          {!result ? (
            <Button onClick={lookup} disabled={loading || !profileCode || !email}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find My Profile
            </Button>
          ) : (
            <div className="space-y-4 border-t border-border pt-4">
              <Field label="Mobile Number" htmlFor="mobileNumber">
                <Input id="mobileNumber" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} />
              </Field>
              <Field label="WhatsApp Number" htmlFor="whatsappNumber">
                <Input id="whatsappNumber" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
              </Field>
              <Field label="Partner Requirements — Additional Expectations" htmlFor="additionalExpectations">
                <Textarea id="additionalExpectations" value={additionalExpectations} onChange={(e) => setAdditionalExpectations(e.target.value)} />
              </Field>
              <Button onClick={submit} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit for Review
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
