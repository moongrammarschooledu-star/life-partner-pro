"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Send, Loader2, CheckCircle2 } from "lucide-react";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { CONTACT_CATEGORIES, CONTACT_LIMITS, contactSchema, type ContactCategory } from "@/lib/public-site/contact";

// One form for /contact and /support. Validation runs in the browser with the same schema the server uses; the server checks again.
// A "Contact Admin" link can prefill ?profileCode= and ?subject= (kept from the old support page).
export function ContactForm({ defaultCategory = "GENERAL" }: { defaultCategory?: ContactCategory }) {
  const params = useSearchParams();
  const [category, setCategory] = useState<ContactCategory>(defaultCategory);
  const [profileCode, setProfileCode] = useState(() => params.get("profileCode") ?? "");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(() => params.get("subject") ?? "");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { category, profileCode, email, subject, message, consent, website };
    const check = contactSchema.safeParse(body);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 429) throw new Error("You are sending messages too quickly. Please wait a minute and try again.");
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Could not send your message. Please try again.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
        <p className="font-medium">Message sent</p>
        <p className="text-sm text-muted">Thank you. Our team will reply to the e-mail address you gave.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="What is this about?" htmlFor="category">
        <Select id="category" value={category} onChange={(e) => setCategory(e.target.value as ContactCategory)}>
          {CONTACT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Your e-mail address" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" maxLength={CONTACT_LIMITS.email} value={email} onChange={(ev) => setEmail(ev.target.value)} required />
      </Field>
      <Field label="Profile ID (optional)" htmlFor="profileCode" hint="Only if you have already registered, for example LPP-000123">
        <Input id="profileCode" maxLength={CONTACT_LIMITS.profileCode} value={profileCode} onChange={(ev) => setProfileCode(ev.target.value)} placeholder="LPP-000123" />
      </Field>
      <Field label="Subject" htmlFor="subject">
        <Input id="subject" maxLength={CONTACT_LIMITS.subject} value={subject} onChange={(ev) => setSubject(ev.target.value)} required />
      </Field>
      <Field label="Message" htmlFor="message" hint="Please do not include passwords, one-time codes or bank details.">
        <Textarea id="message" rows={6} maxLength={CONTACT_LIMITS.message} value={message} onChange={(ev) => setMessage(ev.target.value)} required />
      </Field>

      {/* Honeypot: hidden from people and from assistive technology; a bot that fills it is silently ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(ev) => setWebsite(ev.target.value)} />
      </div>

      <Checkbox
        checked={consent}
        onChange={(ev) => setConsent(ev.target.checked)}
        label="I agree that Life Partner Pro may use these details to reply to my enquiry, as described in the Privacy Policy."
      />
      <p className="text-xs text-muted">
        See the <Link href="/privacy-policy" className="underline">Privacy Policy</Link>. We use your details only to answer this enquiry.
      </p>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={sending}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} Send message
      </Button>
    </form>
  );
}
