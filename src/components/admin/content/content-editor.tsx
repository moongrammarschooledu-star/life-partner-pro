"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContentBody } from "@/components/public/content-body";
import { STATUS_VARIANT } from "@/components/admin/content/content-list";
import { nextStatus, type ContentAction } from "@/lib/content/status";
import { publicPath } from "@/lib/content/paths";

interface Post {
  id: string;
  type: "ARTICLE" | "GUIDE";
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  authorId: string;
  categoryId: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  noindex: boolean;
  scheduledFor: string | null;
  publishedAt: string | null;
  version: number;
  readingMinutes: number;
}
interface Lists {
  authors: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; type: "ARTICLE" | "GUIDE"; slug: string; name: string }>;
}

const ACTION_LABEL: Record<ContentAction, string> = {
  SUBMIT: "Submit for review",
  REQUEST_CHANGES: "Send back to draft",
  PUBLISH: "Publish now",
  SCHEDULE: "Schedule",
  UNSCHEDULE: "Cancel schedule",
  ARCHIVE: "Archive",
  RESTORE: "Restore to draft",
};

function permissionFor(a: ContentAction): string {
  if (a === "SUBMIT" || a === "REQUEST_CHANGES" || a === "UNSCHEDULE") return "content:edit";
  if (a === "ARCHIVE" || a === "RESTORE") return "content:archive";
  return "content:publish";
}

export function ContentEditorClient({ id, permissions }: { id: string; permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const router = useRouter();
  const { show } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [tags, setTags] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/content/${id}`).then((r) => r.json()).then((j) => {
      if (j.post) {
        setPost(j.post);
        setTags((j.post.tags as string[]).join(", "));
      } else show(j.error ?? "Not found.", "error");
    });
    fetch("/api/admin/content").then((r) => r.json()).then(setLists);
  }, [id, show]);
  useEffect(load, [load]);

  async function save() {
    if (!post) return;
    setBusy(true);
    setProblem(null);
    const res = await fetch(`/api/admin/content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: post.slug, title: post.title, summary: post.summary, body: post.body, authorId: post.authorId, categoryId: post.categoryId, tags: tags.split(","), seoTitle: post.seoTitle, seoDescription: post.seoDescription, noindex: post.noindex }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setProblem(j.error ?? "Could not save.");
    show("Saved.", "success");
    load();
  }

  async function act(action: ContentAction) {
    setBusy(true);
    setProblem(null);
    const res = await fetch(`/api/admin/content/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(action === "SCHEDULE" && scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setProblem(j.error ?? "That step could not be completed.");
    show(j.warnings ? `Done, with ${j.warnings} content-policy warning(s) to review.` : "Done.", "success");
    load();
  }

  async function remove() {
    setConfirmDelete(false);
    const res = await fetch(`/api/admin/content/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/content");
    else setProblem(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not delete.");
  }

  if (!post || !lists) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  const set = (patch: Partial<Post>) => setPost({ ...post, ...patch });
  const actions = (["SUBMIT", "REQUEST_CHANGES", "PUBLISH", "SCHEDULE", "UNSCHEDULE", "ARCHIVE", "RESTORE"] as ContentAction[]).filter((a) => nextStatus(a, post.status) && can(permissionFor(a)));
  const cats = lists.categories.filter((c) => c.type === post.type);
  const editable = can("content:edit");
  const live = post.status === "PUBLISHED" || (post.status === "SCHEDULED" && post.scheduledFor !== null && new Date(post.scheduledFor) <= new Date());

  return (
    <div className="space-y-4">
      <ConfirmDialog open={confirmDelete} title="Delete this item?" description="It is removed permanently and cannot be recovered." confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      <Link href="/admin/content" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All items
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">{post.title}</h1>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[post.status]}>{post.status.replace("_", " ").toLowerCase()}</Badge>
          <span className="text-xs text-muted">version {post.version} · {post.readingMinutes} min read</span>
        </div>
      </div>
      {live && (
        <p className="text-sm text-muted">
          Public address: <Link href={publicPath(post.type, post.slug)} className="underline" target="_blank">{publicPath(post.type, post.slug)}</Link>
        </p>
      )}
      {problem && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{problem}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3">
            <Field label="Title" htmlFor="e-title"><Input id="e-title" value={post.title} onChange={(e) => set({ title: e.target.value })} disabled={!editable} maxLength={150} /></Field>
            <Field label="Web address (slug)" htmlFor="e-slug"><Input id="e-slug" value={post.slug} onChange={(e) => set({ slug: e.target.value })} disabled={!editable} maxLength={80} /></Field>
            <Field label="Summary" htmlFor="e-summary"><Textarea id="e-summary" rows={2} value={post.summary} onChange={(e) => set({ summary: e.target.value })} disabled={!editable} maxLength={300} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Author" htmlFor="e-author">
                <Select id="e-author" value={post.authorId} onChange={(e) => set({ authorId: e.target.value })} disabled={!editable}>
                  {lists.authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label="Category" htmlFor="e-cat">
                <Select id="e-cat" value={post.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })} disabled={!editable}>
                  <option value="">None</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Tags" htmlFor="e-tags" hint="Comma-separated, up to 8."><Input id="e-tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={!editable} /></Field>
            <Field label="Text" htmlFor="e-body" hint="## Heading, - list item, **bold**, [link](/page). No raw HTML.">
              <Textarea id="e-body" rows={16} value={post.body} onChange={(e) => set({ body: e.target.value })} disabled={!editable} />
            </Field>
            <Field label="Search title (optional)" htmlFor="e-seot" hint="Up to 70 characters. Falls back to the title."><Input id="e-seot" value={post.seoTitle ?? ""} onChange={(e) => set({ seoTitle: e.target.value || null })} disabled={!editable} maxLength={70} /></Field>
            <Field label="Search description (optional)" htmlFor="e-seod" hint="Up to 170 characters. Falls back to the summary."><Textarea id="e-seod" rows={2} value={post.seoDescription ?? ""} onChange={(e) => set({ seoDescription: e.target.value || null })} disabled={!editable} maxLength={170} /></Field>
            <Checkbox checked={post.noindex} onChange={(e) => set({ noindex: e.target.checked })} label="Ask search engines not to list this page" disabled={!editable} />
            {editable && <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes</Button>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3">
              <p className="font-medium">Workflow</p>
              {post.status === "DRAFT" || post.status === "IN_REVIEW" ? (
                <Field label="Schedule for (your local time)" htmlFor="e-sched" hint="Only used by “Schedule”.">
                  <Input id="e-sched" type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                </Field>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a} size="sm" variant={a === "PUBLISH" ? "primary" : "outline"} disabled={busy || (a === "SCHEDULE" && !scheduledFor)} onClick={() => act(a)}>
                    {ACTION_LABEL[a]}
                  </Button>
                ))}
                {actions.length === 0 && <p className="text-sm text-muted">No steps are available to you for this item right now.</p>}
                {can("content:delete") && (post.status === "DRAFT" || post.status === "ARCHIVED") && (
                  <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
                )}
              </div>
              <p className="text-xs text-muted">Publishing and scheduling run the content policy check first (no guaranteed-outcome claims, no invented statistics, no links to other sites). When review is required, someone other than the last editor must publish.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="mb-3 font-medium">Preview</p>
              <h2 className="font-heading text-xl font-semibold">{post.title}</h2>
              <p className="mt-1 text-sm text-muted">{post.summary}</p>
              <div className="mt-4"><ContentBody body={post.body} /></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
