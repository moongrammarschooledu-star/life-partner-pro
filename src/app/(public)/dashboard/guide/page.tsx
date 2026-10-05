"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

interface Item { slug: string; category: string; title: string; description: string | null; language: string }
interface Article extends Item { body?: string; authorName: string | null }

// STEP 30 - guide centre: published, reviewed articles only, in English or Urdu (Urdu is shown right-to-left).
export default function GuidePage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [open, setOpen] = useState<Article | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (language) params.set("language", language);
    const res = await fetch(`/api/my-guide?${params}`, { cache: "no-store" });
    if (!res.ok) {
      setItems([]);
      return;
    }
    const json = (await res.json()) as { enabled: boolean; items: Item[]; categories: string[] };
    setEnabled(json.enabled);
    setItems(json.items);
    setCategories(json.categories);
  }, [q, category, language]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function openArticle(slug: string) {
    const res = await fetch(`/api/my-guide/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (res.ok) setOpen(((await res.json()) as { article: Article }).article);
  }

  if (open) {
    return (
      <div className="space-y-4">
        <Button size="sm" variant="outline" onClick={() => setOpen(null)}><ArrowLeft className="me-1 h-4 w-4" /> Back to guide</Button>
        <Card>
          <CardContent className="space-y-3" dir={open.language === "UR" ? "rtl" : "ltr"}>
            <h1 className="font-heading text-2xl font-semibold">{open.title}</h1>
            {open.authorName && <p className="text-xs text-muted">{open.authorName}</p>}
            {open.body?.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line text-sm leading-relaxed">{p}</p>)}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Guide</h1>
        <p className="mt-1 text-sm text-muted">Short explanations of how the platform works. Nothing here is a promise about any outcome.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide" className="w-64" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
          <option value="">All topics</option>
          {categories.map((c) => <option key={c} value={c}>{c.replace(/-/g, " ")}</option>)}
        </Select>
        <Select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-36">
          <option value="">Any language</option>
          <option value="EN">English</option>
          <option value="UR">اردو</option>
        </Select>
      </div>
      {items === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{enabled ? "No articles match your search." : "The guide is not available yet."}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((a) => (
            <button key={a.slug} type="button" onClick={() => openArticle(a.slug)} className="text-start">
              <Card className="h-full transition hover:border-primary">
                <CardContent className="space-y-1" dir={a.language === "UR" ? "rtl" : "ltr"}>
                  <p className="text-xs uppercase tracking-wide text-muted">{a.category.replace(/-/g, " ")}</p>
                  <p className="font-medium">{a.title}</p>
                  {a.description && <p className="text-sm text-muted">{a.description}</p>}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
