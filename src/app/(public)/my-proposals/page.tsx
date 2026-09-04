"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Heart, HeartOff, HelpCircle, Phone, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface ProposalItem {
  proposalCode: string;
  createdAt: string;
  status: string;
  compatibilityScore: number | null;
  compatibilityTier: string | null;
  myResponse: "INTERESTED" | "NOT_INTERESTED" | "NEED_MORE_INFO" | null;
  otherProfile: {
    fullName: string;
    profileCode: string;
    age: number;
    city: string;
    country: string;
    education: string | null;
    profession: string | null;
    maritalStatus: string;
    familyType: string | null;
  };
  highlights: string[];
  differences: string[];
}

const DECLINE_REASONS = [
  { value: "DIFFERENT_EXPECTATIONS", label: "Different Expectations" },
  { value: "LOCATION", label: "Location" },
  { value: "AGE", label: "Age" },
  { value: "EDUCATION", label: "Education" },
  { value: "PROFESSION", label: "Profession" },
  { value: "FAMILY_PREFERENCE", label: "Family Preference" },
  { value: "PERSONAL_PREFERENCE", label: "Personal Preference" },
  { value: "OTHER", label: "Other" },
];

function ProposalCard({ proposal, onResponded }: { proposal: ProposalItem; onResponded: () => void }) {
  const { show } = useToast();
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const p = proposal.otherProfile;

  async function respond(response: "INTERESTED" | "NOT_INTERESTED" | "NEED_MORE_INFO") {
    setSubmitting(true);
    try {
      const res = await fetch("/api/my-proposals/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalCode: proposal.proposalCode, response, reason: response === "NOT_INTERESTED" ? reason || undefined : undefined }),
      });
      if (!res.ok) throw new Error();
      if (response === "INTERESTED") {
        setConfirmMessage("Thank you. Your interest has been recorded. Our admin team will review the proposal and guide the next step.");
      }
      setShowDeclineForm(false);
      onResponded();
    } catch {
      show("Could not record your response. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{p.fullName}</CardTitle>
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium">{proposal.status}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted">
          Proposal {proposal.proposalCode} · Received {formatDate(proposal.createdAt)}
          {proposal.compatibilityTier ? ` · ${proposal.compatibilityTier}` : ""}
        </p>

        <div className="grid gap-1 text-sm sm:grid-cols-2">
          <p>Age: {p.age}</p>
          <p>City: {p.city}, {p.country}</p>
          <p>Education: {p.education ?? "—"}</p>
          <p>Profession: {p.profession ?? "—"}</p>
          <p>Marital Status: {formatEnumLabel(p.maritalStatus)}</p>
          <p>Family: {p.familyType ? formatEnumLabel(p.familyType) : "—"}</p>
        </div>

        {(proposal.highlights.length > 0 || proposal.differences.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Compatibility Highlights</p>
              <ul className="mt-1 space-y-1 text-sm">
                {proposal.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> {h}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Points to Consider</p>
              <ul className="mt-1 space-y-1 text-sm">
                {proposal.differences.map((d) => (
                  <li key={d} className="flex items-start gap-1.5">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {confirmMessage ? (
          <p className="rounded-lg bg-success/10 p-3 text-sm text-success">{confirmMessage}</p>
        ) : (
          <>
            {proposal.myResponse && (
              <p className="text-xs text-muted">Your response: {formatEnumLabel(proposal.myResponse)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => respond("INTERESTED")} disabled={submitting}>
                <Heart className="h-4 w-4" /> I Am Interested
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowDeclineForm((s) => !s)} disabled={submitting}>
                <HeartOff className="h-4 w-4" /> Not Interested
              </Button>
              <Button size="sm" variant="outline" onClick={() => respond("NEED_MORE_INFO")} disabled={submitting}>
                <HelpCircle className="h-4 w-4" /> I Need More Information
              </Button>
              <Link href={`/support?profileCode=${p.profileCode}&subject=${encodeURIComponent(`Question about proposal ${proposal.proposalCode}`)}`} className={buttonClass({ size: "sm", variant: "ghost" })}>
                <Phone className="h-4 w-4" /> Contact Admin
              </Link>
            </div>
            {showDeclineForm && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                <Field label="Reason (optional)" htmlFor={`reason-${proposal.proposalCode}`} className="min-w-48">
                  <Select id={`reason-${proposal.proposalCode}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">Prefer not to say</option>
                    {DECLINE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button size="sm" variant="danger" onClick={() => respond("NOT_INTERESTED")} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyProposalsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<ProposalItem[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  function loadProposals() {
    fetch("/api/my-proposals")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setItems(data.items);
          setSignedIn(true);
        } else {
          setSignedIn(false);
        }
      });
  }

  useEffect(() => {
    loadProposals();
  }, []);

  // Reuses the existing /api/my-status identity-proof endpoint (Profile ID +
  // email against ContactInfo.email) rather than a new lookup — it already
  // establishes the same signed applicant-session cookie this page reads.
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
      loadProposals();
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
        <h1 className="font-heading text-2xl font-semibold">My Rishta Proposals</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to view proposals identified for you.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} View My Proposals
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold">My Rishta Proposals</h1>
      <p className="mt-2 text-sm text-muted">
        A potential matrimonial match has been identified for you where shown below. This is a compatibility suggestion for your review — not
        an automatic decision. Contact details are never shared without your and the other party&apos;s consent and admin approval.
      </p>

      <div className="mt-6 space-y-4">
        {items && items.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted">No proposals yet. Your matchmaking team will reach out when a suitable match is identified.</CardContent>
          </Card>
        )}
        {items?.map((p) => (
          <ProposalCard key={p.proposalCode} proposal={p} onResponded={loadProposals} />
        ))}
      </div>
    </div>
  );
}
