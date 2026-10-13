"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, callApi, useApi } from "@/components/admin/system/shared";
import { CcHeader, StatusPill, Table, fmt } from "@/components/admin/platform/cc-shared";

interface Announcement { id: string; kind: string; title: string; body: string; audience: string[]; status: string; showOnStatusPage: boolean; startsAt: string | null; endsAt: string | null; resolvedAt: string | null; createdAt: string }
interface Data { kinds: string[]; audiences: string[]; items: Announcement[]; canManage: boolean }

const KIND_LABEL: Record<string, string> = { MAINTENANCE: "Maintenance", SECURITY_NOTICE: "Security notice", SERVICE_INTERRUPTION: "Service interruption", PLATFORM_UPDATE: "Platform update" };
const AUDIENCE_LABEL: Record<string, string> = { ALL: "Everyone (public)", APPLICANTS: "Applicants", FAMILY: "Family members", ADMINS: "Administrators" };
const toLocalInput = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function AnnouncementsClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Data>("/api/admin/platform/announcements");
  const { show } = useToast();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [kind, setKind] = useState("MAINTENANCE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string[]>(["APPLICANTS"]);
  const [onStatus, setOnStatus] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(a: Announcement | "new") {
    setEditing(a);
    setFormError(null);
    if (a === "new") { setKind("MAINTENANCE"); setTitle(""); setBody(""); setAudience(["APPLICANTS"]); setOnStatus(false); setStartsAt(""); setEndsAt(""); return; }
    setKind(a.kind); setTitle(a.title); setBody(a.body); setAudience(a.audience); setOnStatus(a.showOnStatusPage); setStartsAt(toLocalInput(a.startsAt)); setEndsAt(toLocalInput(a.endsAt));
  }

  async function save() {
    setBusy(true); setFormError(null);
    const payload = { kind, title, body, audience, showOnStatusPage: onStatus, startsAt: toIso(startsAt), endsAt: toIso(endsAt) };
    const res = editing === "new" || editing === null
      ? await callApi("/api/admin/platform/announcements", "POST", payload)
      : await callApi(`/api/admin/platform/announcements/${editing.id}`, "PATCH", { action: "UPDATE", ...payload });
    setBusy(false);
    if (!res.ok) { setFormError(res.data.error ?? "Could not save the announcement."); return; }
    show("Saved as a draft. Publish it when it is ready.", "success"); setEditing(null); reload();
  }

  async function act(a: Announcement, action: "PUBLISH" | "RESOLVE" | "END") {
    const res = await callApi(`/api/admin/platform/announcements/${a.id}`, "PATCH", { action });
    if (!res.ok) { show(res.data.error ?? "That did not work.", "error"); return; }
    show(action === "PUBLISH" ? "Published." : action === "RESOLVE" ? "Marked resolved." : "Ended.", "success"); reload();
  }

  const isPublic = audience.includes("ALL") || onStatus;

  return (
    <div className="space-y-4">
      <CcHeader title="Announcements" description="Notices about maintenance, security and service changes, for the audiences you choose. Anything public or shown on the status page may not contain internal detail, links, addresses or personal data." permissions={permissions} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title="Announcements" action={data.canManage ? <Button size="sm" onClick={() => open("new")}>New announcement</Button> : undefined}>
            <Table head={["Notice", "Audience", "Window", "Status", ""]} empty={data.items.length === 0 ? "No announcements yet." : undefined}>
              {data.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-2 py-2"><span className="font-medium">{a.title}</span><p className="text-xs text-muted">{KIND_LABEL[a.kind] ?? a.kind}{a.showOnStatusPage ? " · on the status page" : ""}</p><p className="mt-1 max-w-md text-xs text-muted">{a.body}</p></td>
                  <td className="px-2 py-2 text-muted">{a.audience.map((x) => AUDIENCE_LABEL[x] ?? x).join(", ")}</td>
                  <td className="px-2 py-2 text-muted">{a.startsAt ? fmt(a.startsAt) : "now"} → {a.endsAt ? fmt(a.endsAt) : "open"}</td>
                  <td className="px-2 py-2"><StatusPill status={a.status} /></td>
                  <td className="space-x-1 whitespace-nowrap px-2 py-2 text-right">
                    {data.canManage && a.status === "DRAFT" && <><Button size="sm" variant="outline" onClick={() => open(a)}>Edit</Button><Button size="sm" onClick={() => act(a, "PUBLISH")}>Publish</Button></>}
                    {data.canManage && a.status === "PUBLISHED" && <><Button size="sm" variant="outline" onClick={() => act(a, "RESOLVE")}>Mark resolved</Button><Button size="sm" variant="ghost" onClick={() => act(a, "END")}>End</Button></>}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-sm text-muted">The public status page is at <Link href="/status" className="text-primary hover:underline">/status</Link>. Whether it is switched on is a platform setting.</p>
          </Card>

          {editing && (
            <Card title={editing === "new" ? "New announcement" : "Edit announcement"}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Kind" htmlFor="an-kind"><Select id="an-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{data.kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</Select></Field>
                <Field label="Title" htmlFor="an-title"><Input id="an-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                <Field label="Text" className="md:col-span-2" htmlFor="an-body" hint="Plain text only. Say what people will notice and when; do not describe causes, systems or people."><Textarea id="an-body" maxLength={1200} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Who sees it</p>
                  {data.audiences.map((a) => <Checkbox key={a} label={AUDIENCE_LABEL[a] ?? a} checked={audience.includes(a)} onChange={(e) => setAudience((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} />)}
                  <Checkbox label="Also show on the public status page" checked={onStatus} onChange={(e) => setOnStatus(e.target.checked)} />
                  {isPublic && <p className="text-xs text-muted"><Badge variant="warning">public</Badge> Public text is checked for internal detail before it can be saved.</p>}
                </div>
                <div className="space-y-3">
                  <Field label="Starts (optional)" htmlFor="an-start"><Input id="an-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
                  <Field label="Ends (optional)" htmlFor="an-end"><Input id="an-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
                </div>
              </div>
              {formError && <p role="alert" className="mt-3 text-sm text-danger">{formError}</p>}
              <div className="mt-3 flex gap-2"><Button disabled={busy || !title.trim() || !body.trim() || audience.length === 0} onClick={save}>{busy ? "Saving…" : "Save draft"}</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
