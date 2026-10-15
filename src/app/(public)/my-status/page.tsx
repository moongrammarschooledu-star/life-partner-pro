"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, ShieldCheck, ShieldQuestion, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button, buttonClass } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";

interface StatusPayload {
  profileCode: string;
  status: string;
  verified: boolean;
  profileCompletion: number;
  createdAt: string;
}

// Spec §18's "Matchmaking Status" derived from the profile status — never
// exposes other applicants or any match list, just a plain-language label.
function matchmakingStatus(status: string): string {
  if (["NEW", "UNDER_REVIEW"].includes(status)) return "Waiting for Admin Review";
  if (status === "VERIFIED") return "Verified — Preparing for Matching";
  if (["ACTIVE", "MATCHING"].includes(status)) return "Matching in Progress";
  if (["PROPOSAL_SENT", "WAITING_FOR_RESPONSE", "INTERESTED", "MEETING_ARRANGED"].includes(status)) return "In Active Discussion";
  if (status === "FINALIZED" || status === "MARRIED") return "Finalized";
  return "On Hold";
}

export default function MyStatusPage() {
  const { show } = useToast();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  // Sign-in is two steps: Profile ID + mobile number (or e-mail), then the one-time code sent to the number / address on the profile.
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [otpChannel, setOtpChannel] = useState<"WHATSAPP" | "SMS" | "EMAIL">("EMAIL");
  const [code, setCode] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/my-status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
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
      if (json.otpRequired) {
        setOtpSentTo(json.destinationMasked ?? "your contact");
        setOtpChannel(json.channel === "WHATSAPP" || json.channel === "SMS" ? json.channel : "EMAIL");
        setCode("");
        return;
      }
      setData(json);
    } finally {
      setLookingUp(false);
    }
  }

  async function verifyCode() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "That code is not valid.", "error");
        return;
      }
      setOtpSentTo(null);
      setData(json);
    } finally {
      setLookingUp(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!data && otpSentTo) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">{otpChannel === "EMAIL" ? "Check your email" : otpChannel === "WHATSAPP" ? "Check WhatsApp" : "Check your messages"}</h1>
        <p className="mt-2 text-sm text-muted">We sent a sign-in code {otpChannel === "WHATSAPP" ? "on WhatsApp" : otpChannel === "SMS" ? "by SMS" : ""} to {otpSentTo}. Enter it below. The code expires in a few minutes; {otpChannel === "EMAIL" ? "if it does not arrive, check your spam folder or " : "if it does not arrive, "}go back and ask for a new one.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Sign-in code" htmlFor="otpCode">
              <Input id="otpCode" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={verifyCode} disabled={lookingUp || code.trim().length < 4}>
                {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Sign in
              </Button>
              <Button variant="outline" onClick={() => { setOtpSentTo(null); setCode(""); }} disabled={lookingUp}>Back</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">My Profile Status</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the mobile number (or e-mail) you registered with. We will send you a sign-in code to confirm it is you.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered mobile number or e-mail" htmlFor="email">
              <Input id="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="+92 300 1234567" />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Send me a sign-in code
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold">My Profile Status</h1>
      <p className="mt-1 text-sm text-muted">Profile ID: <span className="font-mono font-medium text-foreground">{data.profileCode}</span></p>

      <div className="mt-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={data.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Completion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-2.5 rounded-full bg-surface-muted">
              <div className="h-2.5 rounded-full bg-primary" style={{ width: `${data.profileCompletion}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">{data.profileCompletion}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {data.verified ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldQuestion className="h-4 w-4 text-warning" />}
              Verification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">{data.verified ? "Verified" : "Pending"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" /> Matchmaking Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{matchmakingStatus(data.status)}</p>
            <p className="mt-1 text-xs text-muted">
              For your privacy, Life Partner Pro does not show other applicants&apos; profiles or match lists here — your
              matchmaking team will reach out directly.
            </p>
          </CardContent>
        </Card>

        <Link href="/my-verification" className={buttonClass({ className: "w-full justify-center" })}>
          View My Verification
        </Link>
        <Link href="/my-proposals" className={buttonClass({ variant: "outline", className: "w-full justify-center" })}>
          View My Rishta Proposals
        </Link>
        <Link href="/update-request" className={buttonClass({ variant: "outline", className: "w-full justify-center" })}>
          Request Profile Update
        </Link>
      </div>
    </div>
  );
}
