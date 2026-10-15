"use client";

import { useState } from "react";
import { Lock, Eye, Phone, MessageCircle, Mail, Pencil, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { whatsappChatUrl } from "@/lib/whatsapp-link";

interface Contact {
  mobileNumber: string;
  whatsappNumber: string | null;
  email: string | null;
  preferredContactMethod: string;
}

const GREETING = "Assalam-o-Alaikum, this is Life Partner Pro. ";

export function ContactPanel({ profileId, canEdit = true }: { profileId: string; canEdit?: boolean }) {
  const { show } = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ mobileNumber: "", whatsappNumber: "", email: "" });

  async function reveal() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/contact`);
      if (!res.ok) throw new Error();
      setContact(await res.json());
    } catch {
      show("Could not load contact information.", "error");
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    if (!contact) return;
    setDraft({ mobileNumber: contact.mobileNumber, whatsappNumber: contact.whatsappNumber ?? "", email: contact.email ?? "" });
    setEditing(true);
  }

  // Corrects the mobile number, WhatsApp number or e-mail. The server checks the new values, refuses one that another profile already uses, and records which
  // fields changed in the audit log.
  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(json.error ?? "Could not save the contact details.", "error");
        return;
      }
      setContact((c) =>
        c ? { ...c, mobileNumber: draft.mobileNumber.trim(), whatsappNumber: draft.whatsappNumber.trim() || null, email: draft.email.trim() || null } : c
      );
      setEditing(false);
      show(json.changed?.length ? "Contact details updated." : "Nothing was changed.", "success");
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  // The WhatsApp number when the person gave one, otherwise the mobile number.
  const chatUrl = contact ? whatsappChatUrl(contact.whatsappNumber || contact.mobileNumber, GREETING) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-primary" /> Contact Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!contact ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted">Hidden by default. Revealing this information is recorded in the audit log.</p>
            <Button size="sm" variant="outline" onClick={reveal} disabled={loading}>
              <Eye className="h-4 w-4" /> {loading ? "Loading..." : "Reveal Contact Info"}
            </Button>
          </div>
        ) : editing ? (
          <div className="space-y-3 text-sm">
            <Field label="Mobile number" htmlFor="edit-mobile">
              <Input id="edit-mobile" value={draft.mobileNumber} onChange={(e) => setDraft((d) => ({ ...d, mobileNumber: e.target.value }))} placeholder="+92 300 1234567" />
            </Field>
            <Field label="WhatsApp number (optional)" htmlFor="edit-whatsapp">
              <Input id="edit-whatsapp" value={draft.whatsappNumber} onChange={(e) => setDraft((d) => ({ ...d, whatsappNumber: e.target.value }))} placeholder="+92 300 1234567" />
            </Field>
            <Field label="E-mail address" htmlFor="edit-email" hint="A changed mobile number or e-mail is no longer counted as verified.">
              <Input id="edit-email" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="name@example.com" />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted" /> {contact.mobileNumber}
            </p>
            {contact.whatsappNumber && (
              <p className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted" /> {contact.whatsappNumber}
              </p>
            )}
            {contact.email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted" /> {contact.email}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {chatUrl && (
                // Opens WhatsApp on this device with the message written; the admin presses send from their own WhatsApp number. Nothing is sent by the server.
                <a
                  href={chatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
                >
                  <MessageCircle className="h-4 w-4 text-primary" /> Message on WhatsApp
                </a>
              )}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="h-4 w-4" /> Edit contact
                </Button>
              )}
            </div>
            <p className="text-xs text-muted pt-1">Preferred: {contact.preferredContactMethod}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
