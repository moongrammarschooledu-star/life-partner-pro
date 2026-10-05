"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type { ConsentConfig, FormFieldDef } from "@/lib/marketing/form-schema";

// STEP 29 §12/§13/§15 — the public lead form. Consent boxes are unticked by default and shown with their own wording;
// the privacy notice is always linked; a hidden honeypot catches simple bots; the signed form token is fetched after the
// page loads (never embedded in HTML). Nothing here decides anything — the server re-validates every value and consent.

const STRINGS = {
  EN: { submit: "Submit inquiry", sending: "Sending…", thanks: "Thank you. Your inquiry has been received. A member of our team may contact you using the method you chose.", error: "Something went wrong. Please try again.", consentRequired: "Please agree to be contacted about your inquiry.", privacy: "Read our privacy policy", expired: "This form expired — please try again.", channels: { PHONE: "Phone call", WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS" } },
  UR: { submit: "درخواست جمع کرائیں", sending: "بھیجا جا رہا ہے…", thanks: "شکریہ۔ آپ کی درخواست موصول ہو گئی ہے۔ ہماری ٹیم کا کوئی رکن آپ کے منتخب کردہ طریقے سے رابطہ کر سکتا ہے۔", error: "کچھ غلط ہو گیا۔ براہِ کرم دوبارہ کوشش کریں۔", consentRequired: "براہِ کرم اپنی درخواست کے بارے میں رابطے کی اجازت دیں۔", privacy: "ہماری پرائیویسی پالیسی پڑھیں", expired: "فارم کی مدت ختم ہو گئی — دوبارہ کوشش کریں۔", channels: { PHONE: "فون کال", WHATSAPP: "واٹس ایپ", EMAIL: "ای میل", SMS: "ایس ایم ایس" } },
} as const;

const INPUT_TYPE: Record<string, string> = { phone: "tel", whatsapp: "tel", email: "email" };

async function track(type: "FORM_STARTED", touch: string) {
  try {
    await fetch("/api/marketing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, touch }), keepalive: true });
  } catch {
    // analytics must never affect the form
  }
}

export function LeadForm({ formId, fields, consentConfig, touchToken, language }: { formId: string; fields: FormFieldDef[]; consentConfig: ConsentConfig; touchToken: string; language: "EN" | "UR" }) {
  const t = STRINGS[language];
  const [values, setValues] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState({ inquiryContact: false, marketingUpdates: false, whatsapp: false });
  const [hp, setHp] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const loadToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/marketing/forms/${formId}/token`, { cache: "no-store" });
      if (res.ok) setToken(((await res.json()) as { token: string }).token);
    } catch {
      // retried on submit
    }
  }, [formId]);

  useEffect(() => {
    void loadToken();
  }, [loadToken]);

  function onFirstInput() {
    if (started.current) return;
    started.current = true;
    void track("FORM_STARTED", touchToken);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consents.inquiryContact) {
      setMessage(t.consentRequired);
      return;
    }
    setState("sending");
    setMessage(null);
    try {
      const res = await fetch(`/api/marketing/forms/${formId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token ?? "", touch: touchToken, values, consents, hp }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string; code?: string };
      if (res.ok && data.ok) {
        setState("done");
        return;
      }
      if (data.code === "STALE_TOKEN") {
        await loadToken();
        setMessage(t.expired);
      } else {
        setMessage(data.detail ? `${data.error ?? t.error} (${data.detail})` : (data.error ?? t.error));
      }
      setState("error");
    } catch {
      setMessage(t.error);
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div role="status" className="rounded-xl border border-border bg-surface p-5 text-sm">
        {t.thanks}
      </div>
    );
  }

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-5" noValidate>
      {fields.map((f) => {
        const id = `lf-${formId}-${f.key}`;
        const common = { id, required: f.required, value: values[f.key] ?? "", onFocus: onFirstInput, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(f.key, e.target.value), maxLength: f.maxLen ?? (f.key === "inquiry" ? 500 : 160) };
        return (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={id}>
            {f.key === "inquiry" ? (
              <Textarea {...common} rows={3} />
            ) : f.key === "preferredChannel" ? (
              <Select {...common}>
                <option value="">—</option>
                {(["PHONE", "WHATSAPP", "EMAIL", "SMS"] as const).map((c) => (
                  <option key={c} value={c}>{t.channels[c]}</option>
                ))}
              </Select>
            ) : f.options?.length ? (
              <Select {...common}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Input {...common} type={INPUT_TYPE[f.key] ?? "text"} autoComplete="off" />
            )}
          </Field>
        );
      })}

      {/* Honeypot: invisible to people, tempting to bots. */}
      <input type="text" name="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" />

      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={consents.inquiryContact} onChange={(e) => setConsents((c) => ({ ...c, inquiryContact: e.target.checked }))} />
          <span>{consentConfig.inquiryContact.text} *</span>
        </label>
        {consentConfig.marketingUpdates.enabled && consentConfig.marketingUpdates.text && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={consents.marketingUpdates} onChange={(e) => setConsents((c) => ({ ...c, marketingUpdates: e.target.checked }))} />
            <span>{consentConfig.marketingUpdates.text}</span>
          </label>
        )}
        {consentConfig.whatsapp.enabled && consentConfig.whatsapp.text && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={consents.whatsapp} onChange={(e) => setConsents((c) => ({ ...c, whatsapp: e.target.checked }))} />
            <span>{consentConfig.whatsapp.text}</span>
          </label>
        )}
        <p className="text-xs text-muted">
          <Link href="/privacy-policy" className="underline" target="_blank" rel="noopener noreferrer">{t.privacy}</Link>
        </p>
      </div>

      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      <Button type="submit" disabled={state === "sending" || !token}>{state === "sending" ? t.sending : t.submit}</Button>
    </form>
  );
}
