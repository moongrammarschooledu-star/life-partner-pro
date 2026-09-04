"use client";

import { useState } from "react";
import { Phone, MessageCircle, Mail, Send, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export default function SupportPage() {
  const { show } = useToast();
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email, subject, message }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      show("Could not send your message. Please try again.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Support</h1>
      <p className="mt-2 text-muted">Reach our team directly, or send a message and we&apos;ll get back to you.</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Phone className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium">Phone Support</p>
            <p className="text-xs text-muted">Mon–Sat, 10am–6pm</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <MessageCircle className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium">WhatsApp Support</p>
            <p className="text-xs text-muted">Fastest response</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 text-center">
            <Mail className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium">Email Support</p>
            <p className="text-xs text-muted">support@lifepartnerpro (example)</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="font-medium">Message sent</p>
              <p className="text-sm text-muted">Our team will get back to you soon.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Profile ID (optional)" htmlFor="profileCode" hint="e.g. LPP-000123, if you've already registered">
                <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
              </Field>
              <Field label="Your Email" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Subject" htmlFor="subject">
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Message" htmlFor="message">
                <Textarea id="message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <Button onClick={submit} disabled={sending || !email || !subject || !message}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Message
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
