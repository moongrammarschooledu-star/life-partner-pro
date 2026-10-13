"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { slugify } from "@/lib/content/slug";
import { formatDateTime } from "@/lib/utils";

interface Row {
  id: string;
  type: "ARTICLE" | "GUIDE";
  slug: string;
  title: string;
  status: "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  scheduledFor: string | null;
  publishedAt: string | null;
  updatedAt: string;
  category: { name: string } | null;
  author: { name: string };
}
interface Lists {
  items: Row[];
  authors: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; type: "ARTICLE" | "GUIDE"; slug: string; name: string }>;
}

export const STATUS_VARIANT: Record<Row["status"], "default" | "success" | "warning" | "info" | "muted"> = {
  DRAFT: "muted",
  IN_REVIEW: "warning",
  SCHEDULED: "info",
  PUBLISHED: "success",
  ARCHIVED: "default",
};

export function ContentListClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const router = useRouter();
  const { show } = useToast();
  const [data, setData] = useState<Lists | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: "ARTICLE", title: "", slug: "", summary: "", body: "", authorId: "", categoryId: "", tags: "" });
  const [newAuthor, setNewAuthor] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (status) q.set("status", status);
    fetch(`/api/admin/content?${q}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => show("Could not load the content list.", "error"));
  }, [type, status, show]);
  useEffect(load, [load]);

  async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, string> }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, string>;
    return { ok: res.ok, json };
  }

  async function create() {
    setBusy(true);
    const r = await post("/api/admin/content", { ...form, categoryId: form.categoryId || null, tags: form.tags.split(",") });
    setBusy(false);
    if (!r.ok) return show(r.json.error ?? "Could not create.", "error");
    router.push(`/admin/content/${r.json.id}`);
  }

  async function addAuthor() {
    const r = await post("/api/admin/content/authors", { name: newAuthor });
    if (!r.ok) return show(r.json.error ?? "Could not add the author.", "error");
    setNewAuthor("");
    load();
    setForm((f) => ({ ...f, authorId: r.json.id }));
  }

  async function addCategory() {
    const r = await post("/api/admin/content/categories", { type: form.type, slug: slugify(newCategory), name: newCategory });
    if (!r.ok) return show(r.json.error ?? "Could not add the category.", "error");
    setNewCategory("");
    load();
    setForm((f) => ({ ...f, categoryId: r.json.id }));
  }

  const cats = (data?.categories ?? []).filter((c) => c.type === form.type);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Blog &amp; Guides</h1>
          <p className="text-sm text-muted">Articles and guides shown on the public Blog and Guides pages. Only published items are public. Text is checked against the content policy before it goes live.</p>
        </div>
        {can("content:create") && (
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        )}
      </div>

      {creating && (
        <Card>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kind" htmlFor="c-type">
                <Select id="c-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, categoryId: "" })}>
                  <option value="ARTICLE">Blog article</option>
                  <option value="GUIDE">Guide</option>
                </Select>
              </Field>
              <Field label="Author" htmlFor="c-author">
                <Select id="c-author" value={form.authorId} onChange={(e) => setForm({ ...form, authorId: e.target.value })}>
                  <option value="">Choose…</option>
                  {data?.authors.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New author name" htmlFor="c-newauthor" className="flex-1">
                <Input id="c-newauthor" value={newAuthor} onChange={(e) => setNewAuthor(e.target.value)} placeholder="e.g. Editorial Team" />
              </Field>
              <Button variant="outline" onClick={addAuthor} disabled={newAuthor.trim().length < 2}>Add author</Button>
            </div>
            <Field label="Title" htmlFor="c-title">
              <Input id="c-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: slugify(e.target.value) })} maxLength={150} />
            </Field>
            <Field label="Web address (slug)" htmlFor="c-slug" hint="Lowercase letters, digits and hyphens. It cannot be reused.">
              <Input id="c-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} maxLength={80} />
            </Field>
            <Field label="Summary" htmlFor="c-summary" hint="20 to 300 characters. Shown in lists and used as the search description if none is set.">
              <Textarea id="c-summary" rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} maxLength={300} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="c-category">
                <Select id="c-category" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">None</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <Field label="New category" htmlFor="c-newcat" className="flex-1">
                  <Input id="c-newcat" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                </Field>
                <Button variant="outline" onClick={addCategory} disabled={newCategory.trim().length < 2}>Add</Button>
              </div>
            </div>
            <Field label="Tags" htmlFor="c-tags" hint="Comma-separated, up to 8.">
              <Input id="c-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </Field>
            <Field label="Text" htmlFor="c-body" hint="Headings: ## Title. Lists: - item. Bold: **text**. Links: [text](/page) or [text](https://…). No raw HTML.">
              <Textarea id="c-body" rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
            <Button onClick={create} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create draft
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Select aria-label="Filter by kind" value={type} onChange={(e) => setType(e.target.value)} className="w-40">
          <option value="">All kinds</option>
          <option value="ARTICLE">Blog articles</option>
          <option value="GUIDE">Guides</option>
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"].map((s) => (
            <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>
          ))}
        </Select>
      </div>

      {data === null ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing here yet" description="Create a draft to get started. Nothing is public until it is published." />
      ) : (
        <div className="space-y-2">
          {data.items.map((r) => (
            <Link key={r.id} href={`/admin/content/${r.id}`} className="block">
              <Card className="hover:bg-surface-muted">
                <CardContent className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted">
                      {r.type === "GUIDE" ? "Guide" : "Article"} · {r.author.name}
                      {r.category ? ` · ${r.category.name}` : ""} · updated {formatDateTime(r.updatedAt)}
                      {r.status === "SCHEDULED" && r.scheduledFor ? ` · goes live ${formatDateTime(r.scheduledFor)}` : ""}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status.replace("_", " ").toLowerCase()}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
