"use client";

import { useEffect, useState } from "react";
import { Loader2, FileText, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface TemplateItem {
  id: string;
  name: string;
  event: string;
  channel: string;
  language: string;
  subject: string | null;
  message: string;
  status: string;
  variables: string[];
  updatedAt: string;
  updatedBy: { name: string } | null;
}

const NOTIFICATION_TYPES = [
  "ACCOUNT_REGISTERED", "MOBILE_VERIFIED", "EMAIL_VERIFIED", "PROFILE_SUBMITTED", "PROFILE_APPROVED",
  "PROFILE_UPDATE_APPROVED", "PROFILE_UPDATE_REJECTED", "ACCOUNT_SUSPENDED",
  "VERIFICATION_STARTED", "VERIFICATION_APPROVED", "VERIFICATION_ACTION_REQUIRED", "VERIFICATION_REJECTED", "RE_VERIFICATION_REQUIRED",
  "MATCH_IDENTIFIED",
  "PROPOSAL_RECEIVED", "PROPOSAL_VIEWED", "PROPOSAL_INTEREST_SUBMITTED", "PROPOSAL_NOT_INTERESTED", "PROPOSAL_MUTUAL_INTEREST",
  "PROPOSAL_ADMIN_ACTION_REQUIRED", "PROPOSAL_STATUS_CHANGED", "PROPOSAL_PENDING_REMINDER", "PROPOSAL_FINALIZED",
  "CONTACT_PERMISSION_REQUESTED", "CONTACT_PERMISSION_APPROVED", "CONTACT_PERMISSION_REVOKED",
  "MEETING_REQUESTED", "MEETING_SCHEDULED", "MEETING_CONFIRMED", "MEETING_RESCHEDULED", "MEETING_CANCELLED", "MEETING_COMPLETED",
  "MEETING_REMINDER_24H", "MEETING_REMINDER_2H",
  "FOLLOWUP_REMINDER", "FOLLOWUP_ADMIN_RESPONSE_REQUESTED",
  "ADMIN_DIRECT_MESSAGE", "TEST_NOTIFICATION",
];

type DefaultCopyDict = Record<string, Record<string, { title: string; body: string; subject?: string }>>;

function EditorCard({ defaults, safeVariables, onSaved }: { defaults: DefaultCopyDict; safeVariables: string[]; onSaved: () => void }) {
  const { show } = useToast();
  const [event, setEvent] = useState(NOTIFICATION_TYPES[0]);
  const [channel, setChannel] = useState("EMAIL");
  const [language, setLanguage] = useState("EN");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const defaultCopy = defaults[event]?.[language];

  async function save() {
    if (!message.trim()) {
      show("A message is required.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notification-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || event, event, channel, language, subject, message, variables: safeVariables }),
      });
      if (!res.ok) throw new Error();
      show("Template override saved", "success");
      onSaved();
    } catch {
      show("Could not save template.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create / Update Override</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Event" htmlFor="event">
            <Select id="event" value={event} onChange={(e) => setEvent(e.target.value)}>
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t} value={t}>{formatEnumLabel(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Channel" htmlFor="channel">
            <Select id="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="IN_APP">In-App</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </Field>
          <Field label="Language" htmlFor="language">
            <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="EN">English</option>
              <option value="UR">اردو (Urdu)</option>
            </Select>
          </Field>
        </div>
        {defaultCopy && (
          <div className="rounded-md bg-surface-muted p-3 text-xs">
            <p className="font-medium">Current default copy:</p>
            {defaultCopy.subject && <p>Subject: {defaultCopy.subject}</p>}
            <p>{defaultCopy.body}</p>
          </div>
        )}
        <Field label="Template Name" htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={event} />
        </Field>
        {channel === "EMAIL" && (
          <Field label="Subject" htmlFor="subject">
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        )}
        <Field label="Message" htmlFor="message" hint={`Allowed variables: ${safeVariables.map((v) => `{{${v}}}`).join(", ")}`}>
          <Textarea id="message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Override
        </Button>
      </CardContent>
    </Card>
  );
}

export default function NotificationTemplatesPage() {
  const { show } = useToast();
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [defaults, setDefaults] = useState<DefaultCopyDict | null>(null);
  const [safeVariables, setSafeVariables] = useState<string[]>([]);

  function load() {
    fetch("/api/admin/notification-templates")
      .then((r) => r.json())
      .then((json) => setItems(json.items ?? []));
  }

  useEffect(() => {
    load();
    fetch("/api/admin/notification-templates/defaults")
      .then((r) => r.json())
      .then((json) => {
        setDefaults(json.defaults);
        setSafeVariables(json.safeVariables ?? []);
      });
  }, []);

  async function toggleStatus(item: TemplateItem) {
    try {
      const res = await fetch(`/api/admin/notification-templates/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: item.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      show("Could not update template.", "error");
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/admin/notification-templates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      show("Override removed — falls back to default copy", "success");
      load();
    } catch {
      show("Could not remove override.", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Notification Templates</h1>
        <p className="text-sm text-muted">
          Every notification type has built-in English/Urdu copy. Create an override here to customize wording for a specific
          event, channel, and language — deleting an override reverts to the default.
        </p>
      </div>

      {defaults && <EditorCard defaults={defaults} safeVariables={safeVariables} onSaved={load} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Overrides</CardTitle>
        </CardHeader>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={FileText} title="No overrides yet — all notifications use built-in default copy" />
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        {formatEnumLabel(item.event)} · {formatEnumLabel(item.channel)} · {item.language}
                      </span>
                    </div>
                    <Badge variant={item.status === "ACTIVE" ? "success" : "muted"}>{formatEnumLabel(item.status)}</Badge>
                  </div>
                  {item.subject && <p className="mt-1 text-xs text-muted">Subject: {item.subject}</p>}
                  <p className="mt-1 text-xs">{item.message}</p>
                  <p className="mt-1 text-[10px] text-muted">
                    Updated {formatDateTime(item.updatedAt)}{item.updatedBy ? ` by ${item.updatedBy.name}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleStatus(item)}>
                      {item.status === "ACTIVE" ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(item.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
